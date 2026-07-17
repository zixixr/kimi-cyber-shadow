#!/bin/bash
# 全量重新生成影人资产：先武生（锚），再并行其余角色/虎/道具。
# 产物进 tools/raw/，由 postprocess_puppet.py 加工进 assets/。
# 务必绕开本机代理（Azure 请求会挂死），见构建指令文档 2.1。
set -u
cd "$(dirname "$0")/.."

export NO_PROXY="*" no_proxy="*" HTTPS_PROXY= https_proxy= HTTP_PROXY= http_proxy=
PY=tools/.venv/bin/python

echo "== [1/2] wusheng (锚件 head 先文生图，其余以它为风格参照) =="
$PY tools/gen_puppet_parts.py --set wusheng || exit 1

# 串行跑其余集合：部署限 10 RPM，脚本内已是并发 2，多集合并行会撞限速。
echo "== [2/2] wukong / honghaier / tiger / props 串行 =="
rc=0
for s in wukong honghaier tiger props; do
  echo "---- set $s ----"
  $PY tools/gen_puppet_parts.py --set "$s" || rc=1
done
echo "== regen_all done rc=$rc =="
exit $rc
