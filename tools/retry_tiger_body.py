"""一次性重生成 tiger_body：上一版只画了 3 个腿位铆桩（需要 4 个挂独立腿件）。
强调 exactly FOUR leg tabs。复用 gen_puppet_parts 的调用层。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_puppet_parts as g

g.load_env()
anchor = g.RAW / "part_head.png"  # 武生头茬作整套风格锚
prompt = (
    g.TIGER_REF_PREFIX + g.STYLE
    + " Part: The torso piece of a fierce tiger for a shadow puppet, a horizontal "
      "muscular body from neck to rump (no head, no legs, no tail), side profile "
      "facing LEFT, bold carved stripe lattice in ochre and black. It has plain "
      "uncarved rounded leather tabs with a small rivet hole in each: ONE tab at "
      "the neck end (upper left), ONE tab at the tail end (right), and exactly "
      "FOUR leg tabs pointing DOWN from the bottom belly line, evenly spaced from "
      "shoulder to hip (front leg, front-leg-second, hind-leg-third, hind leg "
      "positions). FOUR downward tabs is critical — count them: 1, 2, 3, 4. "
      "Just the torso, nothing else."
)
g.call_with_retry("part:tiger_body", prompt=prompt,
                  out_path=g.RAW / "part_tiger_body.png",
                  size="1024x1024", refs=[anchor] if anchor.exists() else None)
print("done")
