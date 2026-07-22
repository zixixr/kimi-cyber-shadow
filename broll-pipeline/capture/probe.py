"""快速自检：__cap.ready、WebGL 是否出图。小分辨率、抽几帧。
用法： .venv/bin/python broll-pipeline/capture/probe.py [--headed]
"""
import sys, asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path("/private/tmp/claude-501/-Users-xiaotong-Dev-AIVideoEditting/d979eb93-491d-4b40-972b-dd63193f1747/scratchpad/probe")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://localhost:5175"
HEADED = "--headed" in sys.argv


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not HEADED,
            args=["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-webgl"],
        )
        for clip, frame in [(4, 110), (4, 190), (4, 260), (4, 340)]:
            ctx = await browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
            page = await ctx.new_page()
            errs = []
            page.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errs.append(f"PAGEERROR: {e}"))
            await page.goto(f"{BASE}/?clip={clip}", wait_until="networkidle")
            try:
                await page.wait_for_function("window.__cap && window.__cap.ready === true", timeout=15000)
            except Exception as e:
                print(f"clip{clip}: __cap NOT ready — {e}; console={errs[:5]}")
                await ctx.close()
                continue
            await page.evaluate(f"window.__cap.seek({frame})")
            await page.wait_for_timeout(120)
            await page.screenshot(path=str(OUT / f"clip{clip}_f{frame}.png"))
            print(f"clip{clip} f{frame}: OK; frames={await page.evaluate('window.__cap.frames')}; errs={errs[:3]}")
            await ctx.close()
        await browser.close()


asyncio.run(main())
