# 赛博皮影戏（kimi-cyber-shadow）

用摄像头捕捉手势，实时操纵一台**物理真实的 3D 皮影戏台**——灯、幕、影人都是真三维光学模拟：影人是有厚度的 3D 铰链件，灯是 3D 点光源，幕布上的彩色影子由灯位相机每帧实时投影 + 按距离景深虚化后与暖白幕布相乘得到。近灯则影大而虚、贴幕则影小而锐。

两个场景：

- **武松打虎**（默认 `?scene=shuihu`）：剑指持哨棒 → 打枯树两下 → 树倒棒断 → 降级拳脚 → 打虎伏诛。老虎由 AI 或第二只手控制。
- **孙悟空打红孩儿**（`?scene=xiyou`）：双手入镜各控一角；金箍棒双手握棒、火尖枪、三昧真火（张开手）、筋斗云（跳跃）、受击/败阵/胜利谢幕。

## 运行

```bash
npm install
npm run dev        # 打开 http://localhost:5173，授权摄像头
npm test           # Vitest（IK 求解器 / 手势分类 / 玩法逻辑等纯函数单测）
npm run build      # tsc + vite build
```

调试入口：

| 入口 | 说明 |
|---|---|
| `?debug=mouse` | 无摄像头开发：鼠标移动=走位、滚轮=远近、`p`=切手势、左键拖动=指向 |
| `?debug=calib` | 姿势方向标定：方向键切换预设姿势，肉眼核对朝向/符号 |
| 按 `t` | 拖点标定：画面定格，拖 🔥火源 / ✊握棒 / 👤头 / 💪臂长 / 🦵腿长，数值存 localStorage |
| 按 `c` | 换幕：水浒 ↔ 西游（保留 debug 参数，对局状态清零） |
| 按 `r` | 重开当前对局 |

## 手势表

| 手势 | 状态 | 表现 |
|---|---|---|
| 五指张开 | 亮相 | 对观众持续挥手 |
| 握拳 | 拳脚连招 | 直拳→抡拳→踢腿→弓步循环（不识别打击力度） |
| 剑指（食+中指） | 器械套路 | 哨棒/金箍棒：高劈→侧扫→前刺→环绕 |
| 单伸食指 | 指向 | 前手 IK 指向任意方向（360°） |
| 竖拇指 | 傲立 | 叉腰扬后手 |
| 手掌移动 | 走/跑 | 按带方向净速度判定，原地晃不走 |
| 快速上提/下压/甩手 | 跳/蹲/转身 | 按运动幅度自动，带锁定窗口 |

## 技术栈

Three.js（WebGL）+ MediaPipe Tasks Vision（浏览器端手部关键点，双手）+ Vite + TypeScript + Vitest。无引擎、无骨骼蒙皮——影人是「一叠 2mm 厚雕花皮片按铆点铰接」的 `THREE.Group` 铰链树。

```
src/
  main.ts               # 装配总入口：场景路由、加载资产、主渲染循环
  stage/   theater 舞台 / projection 彩色透光投影 / fire 三昧真火 / tree 枯树
           staff 哨棒 / goldenstaff 金箍棒 / spear 火尖枪 / cloud 筋斗云
  puppet/  assembly 铰链装配 / ik 两骨求解器(+单测) / tiger 老虎 / legs 摆锤腿
  hand/    mediapipe 摄像头源 / gestures 手势分类 / director 大脑
           source HandSignal+鼠标调试源 / mapping 关键点常量
  game/    battle 水浒玩法 / xiyou 西游玩法
  ui/      cheatsheet 动作对照表 / calib 姿势标定 / tuner 拖点标定 / calibValues 标定参数
  audio/   sfx 音效
tools/     gen_puppet_parts.py 部件生成 / postprocess_puppet.py 品红抠图矢量化
           freesound_fetch.py 音效抓取 / regen_all.sh 全量重生成
assets/    puppets/{wusheng,wukong,honghaier,tiger}/ + props/ + sfx/
```

## 资产管线（重新生成影人）

影人部件由 Azure OpenAI gpt-image 生成（品红底平面雕花件），凭证读自 `~/.azure-image.env`（见构建指令文档附录 B）：

```bash
python3 -m venv tools/.venv && tools/.venv/bin/pip install -r requirements-tools.txt
tools/regen_all.sh                     # 全量（武生锚件→其余角色/虎/道具），产物进 tools/raw/
# 或单套：NO_PROXY="*" HTTPS_PROXY= HTTP_PROXY= tools/.venv/bin/python tools/gen_puppet_parts.py --set wukong
tools/.venv/bin/python tools/postprocess_puppet.py --set wusheng --size 512            # 抠图矢量化进 assets/
tools/.venv/bin/python tools/postprocess_puppet.py --set wusheng --outroot assets-regen # 先写暂存目录再替换
```

注意：跑生成前务必绕开本机代理（`regen_all.sh` 已内置 `NO_PROXY="*"` 等）；部署限 10 RPM，脚本已内置并发 2 + 指数退避。换角色用「同名部件作布局+风格参照」，`pivots.json` 铆点标注可零调整迁移。

音效来自 freesound（CC-BY），`assets/sfx/*/ ` 内的署名侧车文件必须保留。

## 设计要点（踩坑沉淀，摘自构建指令文档）

- 预设姿势/连招一律 FK，IK 只留「指向」与「握棒跟随」两处；IK 摆固定姿势是多解跳变扭曲的根因。
- 手势比率分母用「掌长单段」（腕→中指根），不用包围盒；握拳做迟滞（进 1.12 / 出 1.32）+ 0.12s 去抖。
- 走路用带方向净速度 EMA 而非速率（挥拳抖动不误判走路）；转身要持续位移 + 1s 锁定（翻手不瞬移）。
- 投影四坑：pass 前 `scene.background=null` 后还原；灯光 `layers.enable(1)`；pass 期间材质 `transmission=0`；幕布采样 RT 时 u 翻转。
- 双手握棒在场景图层用 `worldToLocal` 矩阵解，不手推坐标系；筋斗云高 = 髋 y − cos(腿摆角)×腿长，动态贴脚。
- 凡是方向/位置/比例定不准的问题，用 `t` 拖点标定人眼定，不硬算。

完整规格与避坑地图见 `../KIMI-CODE-赛博皮影戏-构建指令.md`。
