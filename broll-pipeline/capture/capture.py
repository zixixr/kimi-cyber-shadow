"""逐帧 seek + 4K 截图 → ffmpeg 合成 H.264。画面完全由 window.__cap.seek(frame) 决定。
用法： .venv/bin/python broll-pipeline/capture/capture.py --clip 1 [--headed] [--keep]
       .venv/bin/python broll-pipeline/capture/capture.py --all
viewport 1920×1080 + device_scale_factor=2 → 截图 3840×2160（真 4K）。60fps。
"""
import argparse, asyncio, subprocess, shutil
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:5175"  # 默认；可用 --port 覆盖（根 vite 占 5175 时用别的端口）
SCRATCH = Path("/private/tmp/claude-501/-Users-xiaotong-Dev-AIVideoEditting/d979eb93-491d-4b40-972b-dd63193f1747/scratchpad/frames")
OUTDIR = Path("/Users/xiaotong/Dev/AIVideoEditting/projects/2026-07-17-kimi-k3-cyber-shadow-play/sources/broll/pipeline")

NAMES = {
    1: "pipe_01_flat", 2: "pipe_02_cutout", 3: "pipe_03_vectorize",
    4: "pipe_04_extrude", 5: "pipe_05_rivets", 6: "pipe_06_assembly",
}


async def capture_clip(browser, clip: int, clean: bool = True) -> Path:
    frames_dir = SCRATCH / f"clip{clip}"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)

    ctx = await browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    # 默认 clean：隐藏页面自带 chrome（工序头/件名列/说明/计数器/取景框），只留内容主体；
    # 统一「工序 0N·名称」标注由 Remotion 包装层负责。
    url = f"{BASE}/?clip={clip}" + ("&clean=1" if clean else "")
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_function("window.__cap && window.__cap.ready === true", timeout=20000)
    await page.evaluate("document.fonts.ready")
    total = await page.evaluate("window.__cap.frames")
    print(f"clip{clip} ({NAMES[clip]}): {total} 帧 …")

    for f in range(total):
        await page.evaluate(f"window.__cap.seek({f})")
        # 保证合成一帧（含 WebGL）后再截
        await page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        await page.screenshot(path=str(frames_dir / f"{f:05d}.png"))
        if f % 60 == 0:
            print(f"  {f}/{total}")
    await ctx.close()
    if errs:
        print(f"  ⚠ pageerror: {errs[:3]}")
    return frames_dir


def build_mp4(frames_dir: Path, clip: int, out_name: str | None = None):
    OUTDIR.mkdir(parents=True, exist_ok=True)
    out = OUTDIR / (out_name if out_name else f"{NAMES[clip]}.mp4")
    cmd = [
        "ffmpeg", "-y", "-framerate", "60", "-i", str(frames_dir / "%05d.png"),
        "-c:v", "libx264", "-crf", "14", "-preset", "slow",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    print(f"  → {out}")
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--keep", action="store_true", help="保留 PNG 帧")
    ap.add_argument("--chrome", action="store_true", help="保留页面 chrome（默认 clean 无 chrome）")
    ap.add_argument("--out-name", type=str, help="覆盖输出文件名（如样片 pipe_06_assembly_clean_sample.mp4，避免覆盖成片）")
    ap.add_argument("--port", type=int, default=5175, help="broll-pipeline vite 端口（根 vite 占 5175 时改用别的）")
    args = ap.parse_args()
    global BASE
    BASE = f"http://localhost:{args.port}"
    clips = list(NAMES) if args.all else [args.clip]
    clean = not args.chrome

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not args.headed,
            args=["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-webgl"],
        )
        for clip in clips:
            fd = await capture_clip(browser, clip, clean)
            build_mp4(fd, clip, args.out_name if len(clips) == 1 else None)
            if not args.keep:
                shutil.rmtree(fd)
        await browser.close()


asyncio.run(main())
