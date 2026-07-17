#!/usr/bin/env python3
"""Freesound 素材抓取：搜索 → 按评分/下载量排序 → 下载 HQ MP3 预览 → 写署名 sidecar。

凭据从 ~/.freesound.env 读取（FREESOUND_API_KEY）。Token 鉴权可下载 HQ 预览
（~128kbps MP3，环境音用足够）；原始无损文件需 OAuth，暂不需要。

用法：
  .venv/bin/python scripts/freesound_fetch.py \
    --query "rain on leaves" --out-dir downloads/audio-candidates/rain-leaves \
    [--count 3] [--min-duration 20] [--max-duration 120] [--allow-by]

--allow-by 时接受 CC0 与 CC-BY（需署名）；默认只要 CC0。
每个文件旁写 <名>.json：id/name/author/license/url，供 credits 页汇总。
"""
import argparse
import json
import pathlib
import re
import sys

import requests

API = "https://freesound.org/apiv2"


def load_key() -> str:
    env = pathlib.Path.home() / ".freesound.env"
    for line in env.read_text().splitlines():
        if line.startswith("FREESOUND_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"FREESOUND_API_KEY not found in {env}")


def slugify(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()
    return s[:60] or "sound"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--count", type=int, default=3)
    ap.add_argument("--min-duration", type=float, default=20)
    ap.add_argument("--max-duration", type=float, default=120)
    ap.add_argument("--allow-by", action="store_true")
    args = ap.parse_args()

    token = load_key()
    licenses = '("Creative Commons 0" OR "Attribution")' if args.allow_by else '"Creative Commons 0"'
    fltr = f"license:{licenses} duration:[{args.min_duration} TO {args.max_duration}]"
    resp = requests.get(
        f"{API}/search/text/",
        params={
            "query": args.query,
            "filter": fltr,
            "fields": "id,name,username,license,duration,avg_rating,num_downloads,num_ratings,previews,url,tags",
            "sort": "rating_desc",
            "page_size": 30,
            "token": token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    results = resp.json()["results"]
    # 评分可信度：至少 3 人评分优先，其次下载量
    results.sort(key=lambda r: (-(r["avg_rating"] if r["num_ratings"] >= 3 else 0), -r["num_downloads"]))

    out = pathlib.Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    picked = 0
    for r in results:
        if picked >= args.count:
            break
        preview = r["previews"].get("preview-hq-mp3")
        if not preview:
            continue
        stem = f"{r['id']}-{slugify(r['name'])}"
        mp3 = out / f"{stem}.mp3"
        audio = requests.get(preview, params={"token": token}, timeout=60)
        if audio.status_code != 200 or len(audio.content) < 10_000:
            continue
        mp3.write_bytes(audio.content)
        (out / f"{stem}.json").write_text(
            json.dumps(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "author": r["username"],
                    "license": r["license"],
                    "url": r["url"],
                    "duration": r["duration"],
                    "avg_rating": r["avg_rating"],
                    "num_ratings": r["num_ratings"],
                    "num_downloads": r["num_downloads"],
                    "tags": r.get("tags", []),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        print(f"✓ {stem}.mp3  ({r['duration']:.0f}s, ★{r['avg_rating']:.1f}x{r['num_ratings']}, ↓{r['num_downloads']}, {r['license'].split('/')[-3] if '/' in r['license'] else r['license']})")
        picked += 1

    if picked == 0:
        sys.exit(f"no results for query: {args.query}")


if __name__ == "__main__":
    main()
