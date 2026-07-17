"""一次性补生成 honghaier_upper_arm_f：原提示词（"bare chubby child arm"）被 Azure 安全系统误拒，
改为强调皮套袖件、不提儿童肢体的措辞。复用 gen_puppet_parts 的调用层。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_puppet_parts as g

g.load_env()
ref = g.RAW / "part_upper_arm_f.png"  # 武生同名部件作布局+风格参照
prompt = (
    g.CHAR_REF_PREFIX + g.STYLE
    + " Character part: Red Boy (Hong Hai'er) upper-arm sleeve segment of the SAME "
      "shadow puppet character: a short vertical slightly tapered leather sleeve piece "
      "in warm crimson and ochre tones with flame scroll carving and a golden bangle "
      "ring carved around the wider shoulder end, elbow end narrower and rounded, BOTH "
      "ends plain uncarved leather so rivets can pass through. Just this one segment, "
      "nothing else."
)
g.call_with_retry("part:honghaier_upper_arm_f", prompt=prompt,
                  out_path=g.RAW / "part_honghaier_upper_arm_f.png",
                  size="1024x1024", refs=[ref] if ref.exists() else None)
print("done")
