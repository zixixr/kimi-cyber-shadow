"""影人部件后处理：品红抠图 → 外轮廓矢量化 → 贴图三件套。

输入  tools/raw/part_<name>.png（gpt-image-2 原图，品红底 #FF00FF）
输出  assets/puppets/wusheng/
        geometry.json            所有部件 {outline(归一化), bbox}
        <name>_dye.png           染色贴图（孔区近邻填充防溢色）
        <name>_alpha.png         完整 alpha（外轮廓+雕孔）

用法  tools/.venv/bin/python tools/postprocess_puppet.py [--name head] [--size 512]
"""
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "tools" / "raw"
OUT = ROOT / "assets" / "puppets" / "wusheng"

MAGENTA = np.array([255.0, 0.0, 255.0])


def key_magenta(img, thr=170):
    """品红抠图（lingjian postprocess.py 同款思路）：色距<thr → 透明；并去溢色。"""
    rgb = np.array(img.convert("RGB"), dtype=float)
    dist = np.sqrt(((rgb - MAGENTA) ** 2).sum(axis=2))
    alpha = np.where(dist < thr, 0, 255).astype(np.uint8)
    # 去溢色：邻近品红的半透明边缘，把品红分量往邻域均值压
    spill = (dist >= thr) & (dist < thr * 1.35)
    out = rgb.copy()
    g = out[:, :, 1]
    m = spill & (out[:, :, 0] > g + 40) & (out[:, :, 2] > g + 40)
    avg = (out[:, :, 0] + out[:, :, 2]) / 2
    out[:, :, 0] = np.where(m, (out[:, :, 0] + g) / 2, out[:, :, 0])
    out[:, :, 2] = np.where(m, (out[:, :, 2] + g) / 2, out[:, :, 2])
    del avg
    rgba = np.dstack([out.astype(np.uint8), alpha])
    return Image.fromarray(rgba, "RGBA")


def remove_small_components(alpha, min_pixels=96):
    """清掉小连通域噪点（正、负两个方向：孤立小岛与针孔）。"""
    a = alpha > 128
    lab, n = ndimage.label(a)
    sizes = ndimage.sum(a, lab, range(1, n + 1))
    keep = np.zeros_like(a)
    for i, s in enumerate(sizes, start=1):
        if s >= min_pixels:
            keep |= lab == i
    # 反向：胶掉件身内部过小的针孔（<min_pixels/2）
    inv = ~keep
    lab2, n2 = ndimage.label(inv)
    for i in range(1, n2 + 1):
        m = lab2 == i
        if m.sum() < min_pixels // 2 and not (m[0, :].any() or m[-1, :].any() or m[:, 0].any() or m[:, -1].any()):
            keep |= m
    return np.where(keep, 255, 0).astype(np.uint8)


def _cross2(v, w):
    return v[..., 0] * w[..., 1] - v[..., 1] * w[..., 0]


def _rdp(points, eps):
    """Douglas-Peucker 简化（开链）。"""
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    seg = end - start
    d = np.abs(_cross2(seg, points - start)) / (np.linalg.norm(seg) + 1e-12)
    idx = int(np.argmax(d))
    if d[idx] > eps:
        left = _rdp(points[: idx + 1], eps)
        right = _rdp(points[idx:], eps)
        return np.vstack([left[:-1], right])
    return np.array([start, end])


def _rdp_closed(points, eps):
    """闭合轮廓：先去重合尾点，再从点0与最远点处拆成两条开链分别简化。"""
    if np.allclose(points[0], points[-1]):
        points = points[:-1]
    far = int(np.argmax(np.linalg.norm(points - points[0], axis=1)))
    a = _rdp(points[: far + 1], eps)
    b = _rdp(np.vstack([points[far:], points[:1]]), eps)
    return np.vstack([a[:-1], b[:-1]])


def trace_outline(alpha, eps_px=1.5):
    """外轮廓矢量化：最大连通域 → 填孔 → find_contours → RDP → 归一化 CCW。"""
    h, w = alpha.shape
    a = alpha > 128
    lab, n = ndimage.label(a)
    if n == 0:
        raise ValueError("empty alpha")
    largest = np.argmax(ndimage.sum(a, lab, range(1, n + 1))) + 1
    solid = ndimage.binary_fill_holes(lab == largest)
    contours = measure.find_contours(solid.astype(float), 0.5)
    contour = max(contours, key=len)          # (row, col)
    pts = np.stack([contour[:, 1], contour[:, 0]], axis=1)  # → (x, y)
    pts = _rdp_closed(pts, eps_px)
    pts = pts / [w, h]
    if _signed_area(pts) < 0:                 # 保证逆时针（y 向下坐标系）
        pts = pts[::-1]
    return pts.tolist()


def _signed_area(pts):
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)


def polygon_area(pts):
    return abs(_signed_area(np.asarray(pts, dtype=float)))


def point_in_polygon(p, pts):
    x, y = p
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


def fill_holes_rgb(rgb, alpha):
    """孔区/背景用最近的不透明像素颜色填充，避免贴图采样溢出品红。"""
    mask = alpha > 128
    if mask.all():
        return rgb
    _, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
    return rgb[iy, ix]


def process(name, size):
    src = RAW / f"part_{name}.png"
    if not src.exists():
        return None
    rgba = key_magenta(Image.open(src))
    arr = np.array(rgba)
    alpha = remove_small_components(arr[:, :, 3])
    outline = trace_outline(alpha)

    rgb = fill_holes_rgb(arr[:, :, :3], alpha)
    dye = Image.fromarray(rgb).resize((size, size), Image.LANCZOS)
    al = Image.fromarray(alpha).resize((size, size), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    dye.save(OUT / f"{name}_dye.png")
    al.save(OUT / f"{name}_alpha.png")

    ys, xs = np.where(alpha > 128)
    h, w = alpha.shape
    bbox = [float(xs.min() / w), float(ys.min() / h), float(xs.max() / w), float(ys.max() / h)]
    print(f"OK {name}: outline {len(outline)} pts, bbox {[round(b, 3) for b in bbox]}")
    return {"outline": outline, "bbox": bbox}


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--name")
    ap.add_argument("--set", choices=["wusheng", "tiger", "props", "wukong", "honghaier"], default="wusheng")
    ap.add_argument("--size", type=int, default=512)
    args = ap.parse_args()

    if args.set in ("wukong", "honghaier"):
        # 换角色集合：文件 part_<set>_<part>.png，输出键剥掉角色前缀（与 Puppet 关节名一致）
        OUT = ROOT / "assets" / "puppets" / args.set
        prefix = f"{args.set}_"
        all_names = sorted(p.stem[5:] for p in RAW.glob(f"part_{args.set}_*.png"))
        geom_path = OUT / "geometry.json"
        geometry = json.loads(geom_path.read_text()) if geom_path.exists() else {"parts": {}}
        names = [f"{args.set}_{args.name}"] if args.name else all_names
        for name in names:
            r = process(name, args.size)
            if r:
                key = name[len(prefix):]
                geometry["parts"][key] = r
                # 重命名输出贴图为去前缀键名
                for suffix in ("dye", "alpha"):
                    src_f = OUT / f"{name}_{suffix}.png"
                    if src_f.exists():
                        src_f.rename(OUT / f"{key}_{suffix}.png")
        OUT.mkdir(parents=True, exist_ok=True)
        geom_path.write_text(json.dumps(geometry))
        print(f"wrote {geom_path.relative_to(ROOT)} ({len(geometry['parts'])} parts)")
        return

    if args.set == "props":
        OUT = ROOT / "assets" / "props"
        all_names = ["tree"]
    elif args.set == "tiger":
        OUT = ROOT / "assets" / "puppets" / "tiger"
        all_names = sorted(p.stem[5:] for p in RAW.glob("part_tiger_*.png"))
    else:
        all_names = sorted(p.stem[5:] for p in RAW.glob("part_*.png")
                           if not p.stem.startswith("part_tiger_") and p.stem != "part_tree")
    geom_path = OUT / "geometry.json"
    geometry = json.loads(geom_path.read_text()) if geom_path.exists() else {"parts": {}}
    names = [args.name] if args.name else all_names
    for name in names:
        r = process(name, args.size)
        if r:
            geometry["parts"][name] = r
    OUT.mkdir(parents=True, exist_ok=True)
    geom_path.write_text(json.dumps(geometry))
    print(f"wrote {geom_path.relative_to(ROOT)} ({len(geometry['parts'])} parts)")


if __name__ == "__main__":
    main()
