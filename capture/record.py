#!/usr/bin/env python3
# 确定性逐帧 B-roll 录制驱动（配合 src/capture.ts 的 ?capture=1 harness）。
#
# 每条 clip：
#   1) 打开 http://localhost:PORT/?capture=1&scene=..&script=..&cam=..
#      viewport 3840×2160、device_scale_factor=1 → 渲染真 4K；
#   2) 等 window.__cap.ready，逐帧 __cap.step()（固定 dt=1/60）后截图（整视口，含幕后 HTML 标注）；
#   3) ffmpeg -framerate 60 合成 H.264 CRF 14 yuv420p 无音频；编码完删 PNG。
#
# 用法：
#   .venv/bin/python capture/record.py preflight          # WebGL 冒烟测试（小分辨率，非黑判定）
#   .venv/bin/python capture/record.py ik_simple sm_rich optics_front optics_back
#   .venv/bin/python capture/record.py all                # 全部 4 条 + 两条 preview
#   .venv/bin/python capture/record.py previews           # 只重建 preview（吃已存在 mp4）
#
# 注：本机 ffmpeg 无 libfreetype，禁用 drawtext——一切标注由网页渲染（幕后 HTML 标注）。

import subprocess
import sys
import time
import shutil
import re
import os
from pathlib import Path

REPO = Path("/Users/xiaotong/Dev/kimi-demo/kimi-cyber-shadow")
OUT = Path("/Users/xiaotong/Dev/AIVideoEditting/projects/2026-07-17-kimi-k3-cyber-shadow-play/sources/broll")
SCRATCH = Path("/private/tmp/claude-501/-Users-xiaotong-Dev-AIVideoEditting/d979eb93-491d-4b40-972b-dd63193f1747/scratchpad")
W, H, FPS = 3840, 2160, 60

CLIPS = {
    "ik_simple":    dict(script="ik_simple", scene="shuihu", cam="front", dur=12.0, out="ik-compare/ik_simple.mp4"),
    "sm_rich":      dict(script="sm_rich",   scene="shuihu", cam="front", dur=12.0, out="ik-compare/sm_rich.mp4"),
    "optics_front": dict(script="optics",    scene="shuihu", cam="front", dur=15.0, out="optics/optics_front.mp4"),
    "optics_back":  dict(script="optics",    scene="shuihu", cam="back",  dur=15.0, out="optics/optics_back.mp4"),
    # 绕轴连续环绕魔法镜头（视频包装叠加层）：正面停留 1s → 环绕 3.5s → 幕后定住 1.5s，全程 sm_rich 动态
    "orbit":        dict(script="sm_rich",   scene="shuihu", cam="orbit", dur=6.0,  out="optics/orbit_6s.mp4"),
    # 操纵杆特写（4.0s）：幕后侧视缓推，颈+双手三签杆随缓慢亮相摆臂牵动（纯净无标注）
    "rods_closeup": dict(script="reveal",      scene="shuihu", cam="rods",  dur=4.0, out="optics/rods_closeup_4s.mp4"),
    # 置景扫过（6.0s）：幕后 3/4 侧视横移缓推，扫过酒旗 / 山石厚片（见侧面 2mm 厚边），灯 / 幕入画
    "props_pan":    dict(script="props_scene", scene="shuihu", cam="props", dur=6.0, out="optics/props_pan_6s.mp4"),
    # 片头「幕后 3D 奇观」（8.0s）：悟空器械套路 + 两次筋斗云 / 红孩儿三昧真火，低机位侧后缓推
    "hook":         dict(script="xiyou_hook", scene="xiyou", cam="hook", dur=8.0, out="optics/hook_backstage_8s.mp4"),
}


def start_dev():
    """启动 vite dev，解析实际端口。node_modules 已装好，不重装。"""
    proc = subprocess.Popen(
        ["npm", "run", "dev"], cwd=str(REPO),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    port = None
    t0 = time.time()
    while time.time() - t0 < 60:
        line = proc.stdout.readline()
        if not line:
            if proc.poll() is not None:
                raise RuntimeError("vite exited before ready")
            continue
        print("[vite]", line.rstrip())
        m = re.search(r"localhost:(\d+)", line)
        if m:
            port = int(m.group(1))
            break
    if not port:
        proc.terminate()
        raise RuntimeError("could not parse vite port")
    time.sleep(1.0)
    return proc, port


def launch_browser(pw, headless):
    args = [
        "--use-gl=angle", "--use-angle=metal",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist", "--enable-webgl",
        "--disable-frame-rate-limit",
    ]
    return pw.chromium.launch(headless=headless, args=args)


def new_page(browser, w, h):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    return ctx, ctx.new_page()


def wait_ready(page, timeout=45000):
    page.wait_for_function("window.__cap && window.__cap.ready === true", timeout=timeout)


def frame_brightness(png_bytes):
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(png_bytes)).convert("L")
    im.thumbnail((320, 180))
    px = list(im.getdata())
    return sum(px) / len(px), max(px)


def preflight(pw, port):
    """小分辨率冒烟：验证 WebGL 真的画出了东西（max 像素够亮，不是全黑）。"""
    for headless in (True, False):
        try:
            br = launch_browser(pw, headless)
            ctx, page = new_page(br, 960, 540)
            url = f"http://localhost:{port}/?capture=1&scene=shuihu&script=optics&cam=front"
            page.goto(url, wait_until="load")
            wait_ready(page)
            for _ in range(180):  # 推 3s 到贴幕清晰影
                page.evaluate("window.__cap.step()")
            shot = page.screenshot()
            mean, mx = frame_brightness(shot)
            print(f"[preflight headless={headless}] mean={mean:.1f} max={mx}")
            ctx.close(); br.close()
            if mx > 60:
                return headless
        except Exception as e:
            print(f"[preflight headless={headless}] error: {e}")
    raise RuntimeError("WebGL preflight failed in both modes")


def render_clip(pw, port, headless, name):
    cfg = CLIPS[name]
    frames_dir = SCRATCH / f"cap_{name}"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)
    n = round(cfg["dur"] * FPS)

    br = launch_browser(pw, headless)
    ctx, page = new_page(br, W, H)
    url = (f"http://localhost:{port}/?capture=1&scene={cfg['scene']}"
           f"&script={cfg['script']}&cam={cfg['cam']}")
    print(f"[render {name}] {url}  frames={n}")
    page.goto(url, wait_until="load")
    wait_ready(page)
    # 确认真 4K
    dims = page.evaluate("() => { const c=document.querySelector('canvas'); return [c.width, c.height]; }")
    print(f"[render {name}] canvas backing = {dims[0]}x{dims[1]}")
    t0 = time.time()
    for i in range(n):
        page.evaluate("window.__cap.step()")
        page.screenshot(path=str(frames_dir / f"f_{i:05d}.png"), clip={"x": 0, "y": 0, "width": W, "height": H})
        if i % 60 == 0:
            print(f"[render {name}] frame {i}/{n}  ({time.time()-t0:.0f}s)")
    ctx.close(); br.close()

    out_path = OUT / cfg["out"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    encode(frames_dir, out_path)
    shutil.rmtree(frames_dir)
    print(f"[render {name}] -> {out_path}")


def encode(frames_dir, out_path):
    cmd = [
        "ffmpeg", "-y", "-framerate", str(FPS),
        "-i", str(frames_dir / "f_%05d.png"),
        "-c:v", "libx264", "-crf", "14", "-preset", "medium",
        "-pix_fmt", "yuv420p", "-an", str(out_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def build_previews():
    ik = OUT / "ik-compare/ik_simple.mp4"
    sm = OUT / "ik-compare/sm_rich.mp4"
    if ik.exists() and sm.exists():
        out = OUT / "ik-compare/ik_vs_sm_preview.mp4"
        cmd = [
            "ffmpeg", "-y", "-i", str(ik), "-i", str(sm),
            "-filter_complex", "[0:v][1:v]hstack=inputs=2,scale=3840:-2",
            "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(out),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[preview] -> {out}")

    fr = OUT / "optics/optics_front.mp4"
    bk = OUT / "optics/optics_back.mp4"
    if fr.exists() and bk.exists():
        out = OUT / "optics/optics_pip_preview.mp4"
        # 正面大画面 + 幕后小窗（右上角 1/3 宽 PIP，描金边）
        cmd = [
            "ffmpeg", "-y", "-i", str(fr), "-i", str(bk),
            "-filter_complex",
            "[1:v]scale=1280:720,pad=1288:728:4:4:0xc8a05a[pip];[0:v][pip]overlay=W-w-48:48",
            "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(out),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[preview] -> {out}")


def main():
    args = sys.argv[1:] or ["all"]
    from playwright.sync_api import sync_playwright

    if args == ["previews"]:
        build_previews()
        return

    proc, port = start_dev()
    try:
        with sync_playwright() as pw:
            if args == ["preflight"]:
                hl = preflight(pw, port)
                print(f"[preflight] OK, will use headless={hl}")
                return
            headless = preflight(pw, port)
            print(f"[main] using headless={headless}")
            todo = list(CLIPS.keys()) if args == ["all"] else args
            for name in todo:
                if name in CLIPS:
                    render_clip(pw, port, headless, name)
            if args == ["all"] or "optics_front" in todo:
                build_previews()
            if args == ["all"]:
                build_previews()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
