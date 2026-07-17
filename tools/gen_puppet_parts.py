"""赛博皮影戏 — 影人部件生成管线 (Azure OpenAI gpt-image-2)

调用层复用自 ~/Dev/ClaudeFableTest/lingjian-qiyuan/tools/gen_assets.py（已实战验证）。

用法:
  tools/.venv/bin/python tools/gen_puppet_parts.py --name head          # 只生成锚件
  tools/.venv/bin/python tools/gen_puppet_parts.py                      # 全量（head 作风格锚）
  tools/.venv/bin/python tools/gen_puppet_parts.py --name chest --variant 2

- 凭证读自 ~/.azure-image.env
- 文生图走 /images/generations；带风格锚走 /images/edits
- 部署限速 10 RPM：并发 2 + 429/5xx 指数退避
- 原图存 tools/raw/，由 postprocess_puppet.py 加工进 assets/puppets/
"""
import argparse, base64, os, random, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "tools" / "raw"

# ---------------- Azure 调用（搬运自 lingjian gen_assets.py） ----------------

def load_env():
    p = Path("~/.azure-image.env").expanduser()
    if not p.exists():
        sys.exit(f"missing env file: {p}")
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def call_image(prompt, out_path, size="1024x1024", quality="high", refs=None):
    endpoint = os.environ["AZURE_IMAGE_ENDPOINT"].rstrip("/")
    deployment = os.environ["AZURE_IMAGE_DEPLOYMENT"]
    key = os.environ["AZURE_IMAGE_KEY"]
    api_version = os.environ.get("AZURE_IMAGE_API_VERSION", "2025-04-01-preview")
    headers = {"api-key": key}

    if refs:
        url = f"{endpoint}/openai/deployments/{deployment}/images/edits?api-version={api_version}"
        files, handles = [], []
        for ref in refs:
            rp = Path(ref)
            f = open(rp, "rb")
            handles.append(f)
            mime = "image/png" if rp.suffix.lower() == ".png" else "image/jpeg"
            files.append(("image[]", (rp.name, f, mime)))
        data = {"prompt": prompt, "size": size, "n": "1",
                "quality": quality, "output_format": "png"}
        r = requests.post(url, headers=headers, files=files, data=data, timeout=600)
        for f in handles:
            f.close()
    else:
        url = f"{endpoint}/openai/deployments/{deployment}/images/generations?api-version={api_version}"
        body = {"prompt": prompt, "size": size, "n": 1,
                "quality": quality, "output_format": "png"}
        r = requests.post(url, headers=headers, json=body, timeout=600)

    if r.status_code != 200:
        raise RuntimeError(f"http {r.status_code}: {r.text[:400]}")
    item = r.json()["data"][0]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(base64.b64decode(item["b64_json"]))
    return out_path


RETRYABLE = ("http 429", "http 500", "http 502", "http 503", "EngineOverloaded",
             "timeout", "timed out", "Max retries exceeded", "Connection", "RemoteDisconnected")

def call_with_retry(label, **kw):
    for attempt in range(1, 8):
        t0 = time.time()
        try:
            p = call_image(**kw)
            print(f"OK   {label}  attempt {attempt}  {time.time()-t0:.0f}s -> {p.relative_to(ROOT)}", flush=True)
            return p
        except Exception as e:
            msg = str(e)
            retry = any(s.lower() in msg.lower() for s in RETRYABLE)
            print(f"FAIL {label} attempt {attempt} ({time.time()-t0:.0f}s) retryable={retry} :: {msg[:200]}", flush=True)
            if not retry or attempt == 7:
                raise
            delay = min(240, 25 * 2 ** (attempt - 1)) + random.uniform(0, 12)
            print(f"     {label} backing off {delay:.0f}s", flush=True)
            time.sleep(delay)


def run_jobs(jobs, workers=2):
    fails = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(call_with_retry, lb, **kw): lb for lb, kw in jobs}
        for f in as_completed(futs):
            try:
                f.result()
            except Exception as e:
                fails.append((futs[f], str(e)[:200]))
    return fails


# ---------------- 提示词 ----------------
# 关键约束：严格正视平面无阴影；品红底且镂空雕孔同样露出品红；单件孤立。

STYLE = (
    "A single isolated piece of a traditional Chinese shadow puppet (pi ying), "
    "ONE puppet body part only, NOT a whole figure. Strict front-facing flat "
    "orthographic view like a scanned museum artifact: zero perspective, zero "
    "shading, zero highlights, zero 3D effect, zero cast shadow. Style of dyed "
    "translucent cowhide leather with fine intricate openwork carving "
    "(scroll patterns, wave lattice, snowflake lattice), crisp ink-dark cut "
    "outlines, traditional palette of deep crimson red, emerald green, ochre "
    "yellow and ink black on warm parchment-toned leather. "
    "The ENTIRE background is one flat solid uniform magenta color (#FF00FF) "
    "with no gradient, and every carved-out opening INSIDE the leather piece "
    "also shows the same flat magenta through the hole. "
    "Original design, not copied from any existing artwork. "
    "No text, no watermark, no border, no frame."
)

REF_PREFIX = (
    "Use the reference image only as an art-style guide: copy its exact leather "
    "texture rendering, carving-pattern density, outline weight, palette and "
    "flat magenta background treatment, but draw a DIFFERENT body part as "
    "described, consistent as a piece of the SAME puppet character. "
)

# 武生（原创角色"燕青风"）：11 件。每件描述含两端连接处说明（留素皮钉铆位）。
# 画幅内部件应占画面 70% 以上，长条形部件竖放。
PARTS = {
    "head": (
        "The head piece (tou cha) of a young heroic martial-arts male character: "
        "side profile facing LEFT, elegant carved facial features in the classic "
        "openwork style (eyebrow, narrow eye, straight nose bridge in one carved "
        "line), black hair bun with a short crimson headband tail, small ochre "
        "hat crown. Includes the neck stub below the chin, ending in a plain "
        "uncarved rounded leather tab where a rivet would attach. The piece "
        "fills most of the frame."
    ),
    "chest": (
        "The chest-and-shoulders torso piece of the SAME young martial hero, "
        "side profile facing LEFT, wearing a crimson-and-emerald warrior jacket "
        "with dense wave-lattice carving, high collar at the top with a plain "
        "leather tab for the neck rivet, two plain rounded shoulder tabs at the "
        "upper left and upper right edges for arm rivets, and a plain waist tab "
        "at the bottom for the belly rivet. No head, no arms, no legs on this "
        "piece."
    ),
    "belly": (
        "The lower-torso and hip skirt piece of the SAME young martial hero, "
        "side profile facing LEFT: a knee-length pleated battle skirt with "
        "emerald and ochre scroll carving and a crimson sash knot, a plain "
        "leather tab at the top for the chest rivet and two plain tabs at the "
        "bottom hem where the legs attach behind. No torso above the waist, no "
        "legs on this piece."
    ),
    "upper_arm_f": (
        "One upper-arm segment of the SAME young martial hero, a vertical "
        "slightly tapered leather strip with crimson sleeve carving in scroll "
        "pattern: shoulder end wider and rounded, elbow end narrower and "
        "rounded, BOTH ends plain uncarved leather so rivets can pass through. "
        "Just this one segment, nothing else."
    ),
    "lower_arm_f": (
        "One forearm segment of the SAME young martial hero, a vertical "
        "tapered leather strip with emerald sleeve-cuff carving: elbow end "
        "rounded, wrist end narrower, both ends plain uncarved leather for "
        "rivets. Just this one segment, nothing else."
    ),
    "hand_f": (
        "One hand piece of the SAME young martial hero: an open leather hand "
        "with elegantly curved fingers in the classic shadow-puppet gesture "
        "(index extended, others gently curled), parchment tone with ink "
        "outlines, a plain rounded wrist tab for the rivet. Just the hand, "
        "nothing else."
    ),
    "upper_arm_b": (
        "One upper-arm segment of the SAME young martial hero for the far "
        "side of the body, a vertical slightly tapered leather strip with "
        "DARKER muted crimson sleeve carving: shoulder end wider and rounded, "
        "elbow end narrower, both ends plain uncarved leather for rivets. "
        "Just this one segment, nothing else."
    ),
    "lower_arm_b": (
        "One forearm segment of the SAME young martial hero for the far side "
        "of the body, a vertical tapered leather strip with DARKER muted "
        "emerald cuff carving: both ends rounded plain uncarved leather for "
        "rivets. Just this one segment, nothing else."
    ),
    "hand_b": (
        "One hand piece of the SAME young martial hero for the far side of "
        "the body: a leather hand in a loose relaxed grip gesture, slightly "
        "darker parchment tone, a plain rounded wrist tab for the rivet. Just "
        "the hand, nothing else."
    ),
    "leg_f": (
        "One full leg piece of the SAME young martial hero: a vertical leather "
        "piece from upper thigh to foot, ochre trousers with sparse scroll "
        "carving and a black knee-high boot with a slightly upturned toe "
        "pointing LEFT, hip end rounded plain uncarved leather for the rivet. "
        "Just this one leg, nothing else."
    ),
    "leg_b": (
        "One full leg piece of the SAME young martial hero for the far side "
        "of the body: a vertical leather piece from upper thigh to foot, "
        "DARKER muted ochre trousers and a black boot with upturned toe "
        "pointing LEFT, hip end rounded plain for the rivet. Just this one "
        "leg, nothing else."
    ),
    "hand_fist": (
        "One clenched fist piece of the SAME young martial hero, seen from "
        "the SIDE in strict profile (thumb side toward the viewer): a compact "
        "closed fist with the curled index finger and the thumb pressed over "
        "it clearly visible, knuckles up, parchment leather tone with crisp "
        "ink outlines, a short plain rounded wrist tab ABOVE the fist with a "
        "small rivet hole. The fist hangs below the tab, fingers pointing "
        "DOWNWARD. Just this one fist, nothing else."
    ),
}

ANCHOR = "head"

# 换角色变体：以武生同名部件为「布局+风格」参照生成，铆位布置一致 → 铆点标注可迁移
CHAR_REF_PREFIX = (
    "Use the reference image as BOTH layout and style guide: keep the SAME "
    "piece type, orientation, overall proportions, and the SAME plain rivet "
    "tab positions with holes, and the same leather/carving rendering style "
    "and magenta background treatment — but REDESIGN the artwork as the "
    "character described below. "
)
CHAR_VARIANTS = {
    "wukong": {  # 孙悟空：猴脸紧箍、黄金甲、虎皮裙、毛臂
        "head": "Sun Wukong the Monkey King's head piece: monkey face side profile facing LEFT with furry cheeks, round golden fillet band (jingu) across the brow, bright alert eye, slight grin showing resolve, dark fur with crimson accents, small pheasant-feather plume on the cap.",
        "chest": "Sun Wukong's chest piece: golden chain-mail battle jacket (suozi huangjin jia) in ochre-gold with ink outlines and crimson trim, high collar.",
        "belly": "Sun Wukong's lower-torso piece: the iconic tiger-skin battle skirt (hupi qun) with bold ochre-and-black tiger stripes, crimson sash knot.",
        "upper_arm_f": "Sun Wukong's upper-arm segment: brown furry monkey arm with a golden armlet band at the shoulder end.",
        "lower_arm_f": "Sun Wukong's forearm segment: brown furry monkey forearm with a shining golden bracer at the wrist end.",
        "hand_f": "Sun Wukong's hand piece: furry monkey hand in a loose grip.",
        "upper_arm_b": "Sun Wukong's far-side upper-arm segment: DARKER muted brown furry monkey arm with golden armlet.",
        "lower_arm_b": "Sun Wukong's far-side forearm segment: DARKER muted furry forearm with golden bracer.",
        "hand_b": "Sun Wukong's far-side hand piece: DARKER furry monkey hand in a loose grip.",
        "leg_f": "Sun Wukong's leg piece: furry monkey leg wearing the tiger-skin knee wrap and a black cloud-stepping boot with upturned toe pointing LEFT.",
        "leg_b": "Sun Wukong's far-side leg piece: DARKER furry leg with tiger-skin wrap and black boot, toe pointing LEFT.",
    },
    "honghaier": {  # 红孩儿：双抓髻娃娃、红肚兜、赤臂金镯
        "head": "Red Boy (Hong Hai'er) the child demon's head piece: a chubby CHILD's face side profile facing LEFT, two round hair buns (shuangzhuaji) tied with crimson ribbons, big lively eye, mischievous smile, rosy cheek.",
        "chest": "Red Boy's chest piece: bare-shouldered crimson bellyband (dudou) with a golden lotus emblem carved in the center, soft child shoulders.",
        "belly": "Red Boy's lower-torso piece: crimson silk shorts with emerald sash and small flame motifs carved along the hem.",
        "upper_arm_f": "Red Boy's upper-arm segment: bare chubby child arm in warm parchment tone with a golden bangle at the shoulder end.",
        "lower_arm_f": "Red Boy's forearm segment: bare chubby child forearm with a golden bangle at the wrist.",
        "hand_f": "Red Boy's hand piece: small chubby child hand in a loose grip.",
        "upper_arm_b": "Red Boy's far-side upper-arm segment: DARKER muted bare child arm with golden bangle.",
        "lower_arm_b": "Red Boy's far-side forearm segment: DARKER muted bare child forearm with bangle.",
        "hand_b": "Red Boy's far-side hand piece: DARKER small child hand in a loose grip.",
        "leg_f": "Red Boy's leg piece: bare chubby child leg with a golden anklet and small red shoe with upturned toe pointing LEFT.",
        "leg_b": "Red Boy's far-side leg piece: DARKER bare child leg with anklet and red shoe, toe pointing LEFT.",
    },
}

# 道具：景阳冈枯树（哨棒打断用）
PARTS_PROPS = {
    "tree": (
        "A gnarled old leafless tree for a shadow puppet stage set, single "
        "isolated piece: thick twisted trunk rising from a root base, several "
        "bare crooked branches, carved openwork bark texture and knot holes, "
        "ochre and ink-black leather tones. The trunk base is wide and flat "
        "at the bottom. Fills most of the frame vertically. Just the one "
        "tree, nothing else."
    ),
}

# 虎形影人（武松打虎的虎）：7 件平面铰链件，风格锚定用武生头茬保持整套皮影一致。
TIGER_REF_PREFIX = (
    "Use the reference image only as an art-style guide: copy its exact leather "
    "texture rendering, carving-pattern density, outline weight, palette and "
    "flat magenta background treatment, but draw a TIGER body part as described "
    "(NOT a human part), consistent as a piece of the same shadow-puppet set. "
)
PARTS_TIGER = {
    "tiger_head": (
        "The head piece of a fierce tiger for a shadow puppet, side profile "
        "facing LEFT: open roaring jaw with carved fangs, one visible eye, "
        "ears back, bold carved tiger stripes in ochre and ink black with "
        "crimson accents, the wang (king) forehead marking as openwork. Neck "
        "end is a plain uncarved rounded leather tab with a small rivet hole. "
        "Just the head, nothing else."
    ),
    "tiger_body": (
        "The torso piece of the SAME tiger, a horizontal muscular body from "
        "neck to rump (no head, no legs, no tail), side profile facing LEFT, "
        "bold carved stripe lattice in ochre and black, plain uncarved tabs "
        "with small rivet holes at the neck end (left), tail end (right), and "
        "four leg positions along the belly line. Just the torso."
    ),
    "tiger_leg_nf": (
        "One FRONT leg piece of the SAME tiger, vertical, from shoulder to a "
        "big clawed paw, carved stripes, top end plain rounded leather tab "
        "with rivet hole. Just this one leg."
    ),
    "tiger_leg_ff": (
        "One FRONT leg piece of the SAME tiger for the far side, vertical, "
        "DARKER muted tones, shoulder-to-paw with claws, top tab with rivet "
        "hole. Just this one leg."
    ),
    "tiger_leg_nh": (
        "One HIND leg piece of the SAME tiger, vertical with a thick bent "
        "haunch and clawed paw, carved stripes, top end plain rounded tab "
        "with rivet hole. Just this one leg."
    ),
    "tiger_leg_fh": (
        "One HIND leg piece of the SAME tiger for the far side, DARKER muted "
        "tones, thick haunch to clawed paw, top tab with rivet hole. Just "
        "this one leg."
    ),
    "tiger_tail": (
        "The long tail piece of the SAME tiger, a gracefully S-curved striped "
        "tail thick at the base tapering to the tip, base end plain rounded "
        "tab with rivet hole. Just the tail."
    ),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", help="只生成指定部件")
    ap.add_argument("--set", choices=["wusheng", "tiger", "props", "wukong", "honghaier"], default="wusheng")
    ap.add_argument("--variant", type=int, help="候选稿编号：输出 raw/candidates/<name>_vNN.png")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    load_env()
    RAW.mkdir(parents=True, exist_ok=True)

    if args.set in CHAR_VARIANTS:
        variant = CHAR_VARIANTS[args.set]
        jobs = []
        for part, desc in variant.items():
            if args.name and args.name != part:
                continue
            out = RAW / f"part_{args.set}_{part}.png"
            if not (args.force or not (out.exists() and out.stat().st_size > 30_000)):
                continue
            ref = RAW / f"part_{part}.png"  # 武生同名部件作布局参照
            jobs.append((f"part:{args.set}_{part}", dict(
                prompt=CHAR_REF_PREFIX + STYLE + " Character part: " + desc,
                out_path=out, size="1024x1024",
                refs=[ref] if ref.exists() else None)))
        fails = run_jobs(jobs)
        print("\n=== done ===")
        if fails:
            for lb, msg in fails:
                print(f"FAILED {lb}: {msg}")
            sys.exit(1)
        return

    if args.set == "props":
        anchor_path = RAW / f"part_{ANCHOR}.png"
        jobs = []
        for k, desc in PARTS_PROPS.items():
            if args.name and args.name != k:
                continue
            out = RAW / f"part_{k}.png"
            if not (args.force or not (out.exists() and out.stat().st_size > 30_000)):
                continue
            jobs.append((f"part:{k}", dict(
                prompt=TIGER_REF_PREFIX.replace("a TIGER body part", "a stage PROP") + STYLE + " Part: " + desc,
                out_path=out, size="1024x1024",
                refs=[anchor_path] if anchor_path.exists() else None)))
        fails = run_jobs(jobs)
        print("\n=== done ===")
        if fails:
            for lb, msg in fails:
                print(f"FAILED {lb}: {msg}")
            sys.exit(1)
        return

    if args.set == "tiger":
        # 虎组：全部以武生头茬为风格锚
        anchor_path = RAW / f"part_{ANCHOR}.png"
        jobs = []
        for k, desc in PARTS_TIGER.items():
            if args.name and args.name != k:
                continue
            out = RAW / f"part_{k}.png"
            if not (args.force or not (out.exists() and out.stat().st_size > 30_000)):
                continue
            jobs.append((f"part:{k}", dict(
                prompt=TIGER_REF_PREFIX + STYLE + " Part: " + desc,
                out_path=out, size="1024x1024",
                refs=[anchor_path] if anchor_path.exists() else None)))
        fails = run_jobs(jobs)
        print("\n=== done ===")
        if fails:
            for lb, msg in fails:
                print(f"FAILED {lb}: {msg}")
            sys.exit(1)
        return

    def out_path(name):
        if args.variant is None:
            return RAW / f"part_{name}.png"
        return RAW / "candidates" / f"{name}_v{args.variant:02d}.png"

    def want(path):
        return args.force or args.variant is not None or not (path.exists() and path.stat().st_size > 30_000)

    fails = []
    anchor_path = RAW / f"part_{ANCHOR}.png"

    if (not args.name or args.name == ANCHOR) and want(out_path(ANCHOR)):
        call_with_retry(f"part:{ANCHOR}",
                        prompt=STYLE + " Part: " + PARTS[ANCHOR],
                        out_path=out_path(ANCHOR), size="1024x1024")

    jobs = []
    for k, desc in PARTS.items():
        if k == ANCHOR or (args.name and args.name != k):
            continue
        out = out_path(k)
        if not want(out):
            continue
        refs = [anchor_path] if anchor_path.exists() else None
        prefix = REF_PREFIX if refs else ""
        jobs.append((f"part:{k}", dict(
            prompt=prefix + STYLE + " Part: " + desc,
            out_path=out, size="1024x1024", refs=refs)))
    fails += run_jobs(jobs)

    print("\n=== done ===")
    if fails:
        for lb, msg in fails:
            print(f"FAILED {lb}: {msg}")
        sys.exit(1)


if __name__ == "__main__":
    main()
