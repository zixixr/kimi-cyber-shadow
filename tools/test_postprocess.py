"""postprocess_puppet 自测：合成品红底测试图验证抠图与轮廓矢量化。"""
import numpy as np
from PIL import Image, ImageDraw

from postprocess_puppet import key_magenta, remove_small_components, trace_outline, polygon_area


def make_test_image():
    """256x256 品红底，中央 60,60-196,196 红色圆角矩形，内部两个品红孔。"""
    img = Image.new("RGB", (256, 256), (255, 0, 255))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([60, 60, 196, 196], radius=18, fill=(180, 40, 40), outline=(20, 10, 10), width=3)
    d.ellipse([90, 90, 120, 120], fill=(255, 0, 255))   # 雕孔1
    d.ellipse([140, 130, 170, 160], fill=(255, 0, 255)) # 雕孔2
    return img


def main():
    img = make_test_image()
    rgba = key_magenta(img)
    a = np.array(rgba)[:, :, 3]

    # 1. 背景与雕孔透明，件身不透明
    assert a[5, 5] == 0, "背景应透明"
    assert a[105, 105] == 0, "雕孔1应透明"
    assert a[145, 155] == 0, "雕孔2应透明"
    assert a[128, 70] == 255, "件身应不透明"

    # 2. 清噪不应移除主体
    a2 = remove_small_components(a, min_pixels=96)
    assert a2.sum() > 0.9 * a.sum(), "清噪不应损伤主体"

    # 3. 外轮廓：面积接近矩形（雕孔不参与），点为归一化坐标
    poly = trace_outline(a2)
    assert len(poly) >= 8, f"轮廓点太少: {len(poly)}"
    pts = np.array(poly, dtype=float)
    assert pts.min() >= 0.0 and pts.max() <= 1.0, "轮廓点应归一化到 [0,1]"
    area = polygon_area(pts) * 256 * 256
    expect = 136 * 136  # 圆角矩形近似
    assert abs(area - expect) / expect < 0.08, f"外轮廓面积偏差过大: {area} vs {expect}"

    # 4. 外轮廓不应包含雕孔（孔心应在多边形内部）
    from postprocess_puppet import point_in_polygon
    assert point_in_polygon((105 / 256, 105 / 256), pts), "雕孔应位于外轮廓内部（说明轮廓只描了外圈）"

    print("ALL TESTS PASS")


if __name__ == "__main__":
    main()
