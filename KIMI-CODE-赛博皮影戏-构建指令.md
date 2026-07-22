# 赛博皮影戏 · 完整构建指令文档（交付 Kimi Code）

> **给 Kimi Code 的话**：这是一份端到端的项目构建规格 + 避坑地图。它来自一个已跑通的参考实现，把踩过的每一个坑都写成了「不要这样做，要那样做」。请**通读全文后再动手**，尤其是第 6 章（控制系统）和第 10 章（踩坑百科）——那里的每一条都是付过学费的。遇到与你直觉相悖的约定（比如"预设姿势不要用 IK"），请相信文档，它是被反复验证过的结论。

---

## 0. 这个项目是什么

**一句话**：用摄像头捕捉手势，实时操纵一台**物理真实的 3D 皮影戏台**——灯、幕、影人都是真三维光学模拟，幕布上的彩色影子是引擎每帧实时投影计算出来的，而不是贴图或 2D 精灵。

**为什么新颖（这是立项的核心卖点，务必守住）**：
- 传统皮影戏是 2D 的。本项目的颠覆点是「**你以为是 2D，其实每一帧都是 3D 光学模拟**」——影人是有厚度的 3D 铰链件，灯是 3D 点光源，影子是灯位相机把影人投到幕布上、按距离做景深虚化后，与暖白幕布相乘得到的**彩色透光影**。近灯则影大而虚、贴幕则影小而锐，完全符合真实皮影的光学。
- 手势控制：不用手柄、不用键盘，摄像头看手，手势即角色状态。这是传播钩子（作者做过手控圣诞树，有受众基础）。
- 文化原创性：题材取自中国古典（武松打虎、悟空打红孩儿），但影人形象全部 AI 原创生成，不抄袭任何现存皮影。

**最终画面**：两个场景。①武松打虎（景阳冈、枯树、哨棒打断名场面）；②孙悟空打红孩儿（金箍棒、火尖枪、三昧真火、筋斗云）。

---

## 1. 技术栈与脚手架

| 层 | 选型 | 说明 |
|---|---|---|
| 渲染 | **Three.js**（`three@^0.185`） | WebGL，无需引擎 |
| 手势 | **MediaPipe Tasks Vision**（`@mediapipe/tasks-vision@^0.10`） | 浏览器端手部关键点，支持多手 |
| 构建 | **Vite** + **TypeScript** | `vite` 开发、`tsc && vite build` 产出 |
| 测试 | **Vitest** | 纯函数全测：IK 求解器、手势分类、玩法逻辑、开场报幕、筋斗云/真火等 |
| 资产生成 | **Python 3** + `requests` `pillow` `numpy` `scipy` `scikit-image` | 离线跑，产物入 `assets/` |

**脚手架命令**：
```bash
npm create vite@latest cyber-shadow-play -- --template vanilla-ts
cd cyber-shadow-play
npm i three @mediapipe/tasks-vision
npm i -D @types/three vitest
```

**目录结构**（建议照搬，职责单一、改一处不牵一发）：
```
src/
  main.ts               # 装配总入口：场景路由、加载资产、主渲染循环
  stage/
    theater.ts          # 舞台：幕布/木框/灯/光锥/体积光尘埃，导出坐标常量
    projection.ts       # 彩色透光投影核心（RT + 景深模糊 + 幕布 shader，gl_FrontFacing 分正背面）
    fire.ts             # 三昧真火粒子
    tree.ts             # 枯树道具（哨棒打断机制）
    staff.ts            # 哨棒（武松）/ goldenstaff.ts 金箍棒（双手握棒）
    spear.ts            # 火尖枪 / cloud.ts 筋斗云
    props.ts            # 传统布景：酒旗/山石/火云洞，按场景摆放
  puppet/
    assembly.ts         # Puppet 类：铰链装配、FK/IK 手臂、腿、比例、投影钩子、连接桩擦除
    ik.ts + ik.test.ts  # 两骨 IK 求解器（纯函数 + 单测）
    tiger.ts            # 老虎（独立 AI + 手势可控）
    legs.ts             # 被动摆锤腿（走路自然摆动）
  hand/
    mediapipe.ts        # 摄像头 → 手部关键点 → 归一化信号
    gestures.ts         # 关键点 → 手势分类（张开/握拳/食指/剑指/拇指）
    director.ts         # 「大脑」：手→角色路由、运动层、手势状态机 → PuppetControl
    source.ts           # HandSignal 接口 + 鼠标调试源（无摄像头也能开发）
    mapping.ts          # 关键点索引常量
  game/
    battle.ts           # 武松打虎玩法链（命中判定/树倒棒断/虎 AI）
    xiyou.ts            # 悟空打红孩儿玩法（双手双角色/受击/谢幕）
  ui/
    cheatsheet.ts       # 动作对照表（实时高亮当前手势）
    calib.ts            # 姿势方向标定（方向键切预设姿势，肉眼核对）
    tuner.ts            # 拖点标定工具（见第 8 章）
    calibValues.ts      # 标定参数中心（代码默认值 + localStorage 覆盖）
    opening.ts          # 开场报幕（灯亮-锣鼓-字幕牌，纯时序函数 + 单测）
    backstage.ts        # 幕后模式（b 键环绕 + 三杆操纵可视化 + 投影原理标注）
  audio/
    sfx.ts              # 音效播放（锣鼓/吼/断木/BGM）
tools/
  gen_puppet_parts.py   # GPT Image 部件生成
  postprocess_puppet.py # 品红抠图 → 矢量化 → 贴图三件套
  freesound_fetch.py    # 开源音效抓取
  regen_all.sh          # 全量重生成（内置绕代理 + 并发 2 + 指数退避）
assets/
  puppets/{wusheng,wukong,honghaier,tiger}/  # 每套：geometry.json + pivots.json + *_dye.png + *_alpha.png
  props/                # 枯树/酒旗/山石/火云洞
  sfx/                  # 音效 + CC-BY 署名侧车
broll-pipeline/  capture/  # （可选）传播视频录制管线：逐 clip 动画页 + Python 录屏
```

---

## 2. 资产管线：用 GPT Image 生成皮影部件（重头戏）

这是整个项目"用对领域知识把 3D 建模难题降维"的关键。**不用 Blender、不做 3D 建模、不做骨骼蒙皮**。皮影本质是"一叠有厚度的平面雕花皮片，用铆钉铰接"——所以我们只需生成**平面雕花件的正视图**，再挤出 2mm 厚度、按铆点铰接。

### 2.1 模型与调用方式

- 模型：**Azure OpenAI `gpt-image-2`** 部署（文生图 `/images/generations`，带参考图 `/images/edits`）。
- 凭证读自 `~/.azure-image.env`：
  ```
  AZURE_IMAGE_ENDPOINT=https://xxx.openai.azure.com
  AZURE_IMAGE_DEPLOYMENT=<部署名>
  AZURE_IMAGE_KEY=<key>
  AZURE_IMAGE_API_VERSION=2025-04-01-preview
  ```
- **限速处理**（务必实现，否则批量生成必崩）：部署限 10 RPM。用**并发 2 + 指数退避**（429/5xx/超时都退避，`min(240, 25×2^(n-1)) + 随机抖动`，最多 7 次）。
- **代理陷阱**（付过学费）：如果本机开了 HTTP 代理（如 `127.0.0.1:10808`），Azure 请求会**挂死 20+ 分钟无输出**。跑生成脚本前务必绕开：
  ```bash
  NO_PROXY="*" no_proxy="*" HTTPS_PROXY= https_proxy= HTTP_PROXY= http_proxy= \
    python tools/gen_puppet_parts.py
  ```

### 2.2 三条铁律（提示词的成败全在这里）

1. **单件孤立，不是整个人**。每次只生成"一个身体部件"（一只小臂、一个头茬），画面里**只有这一件**。提示词反复强调 `ONE puppet body part only, NOT a whole figure` / `Just this one segment, nothing else`。否则模型会画出整个小人，无法铰接。

2. **严格正视平面、零光影、零透视、零投影**。像扫描博物馆藏品：`Strict front-facing flat orthographic view … zero shading, zero highlights, zero 3D effect, zero cast shadow`。任何立体光影都会毁掉后续的品红抠图和厚度挤出。

3. **纯品红背景 + 镂空雕孔也露品红**。整个背景是一块死板均匀的品红 `#FF00FF`，**且皮片内部所有镂空雕孔透出的也是同一品红**。这是抠图的关键——皮影的雕花镂空必须被抠成透明，否则透光效果全无。提示词：`The ENTIRE background is one flat solid uniform magenta color (#FF00FF) … and every carved-out opening INSIDE the leather piece also shows the same flat magenta through the hole.`

### 2.3 风格统一：锚件 + 参考图

一套影人 11 件（人形），必须风格一致（同样的皮革质感、雕花密度、描边粗细、配色）。做法：
1. 先**只生成一个锚件**（头茬 `head`），文生图。
2. 其余所有件用 `/images/edits` 把**锚件作为风格参考图**传入，提示词加前缀：
   ```
   Use the reference image only as an art-style guide: copy its exact leather
   texture rendering, carving-pattern density, outline weight, palette and flat
   magenta background treatment, but draw a DIFFERENT body part as described,
   consistent as a piece of the SAME puppet character.
   ```

### 2.4 换角色的"布局参照"技巧（省掉重新标定铆点）

这是**最省事的一招**。要生成悟空、红孩儿等新角色时，**不要从零生成**，而是把武生（基础角色）的**同名部件**作为「布局 + 风格」双重参照：
```
Use the reference image as BOTH layout and style guide: keep the SAME piece
type, orientation, overall proportions, and the SAME plain rivet tab positions
with holes, and the same leather/carving rendering style and magenta background
treatment — but REDESIGN the artwork as the character described below.
```
**收益**：新角色的铆位（肩、肘、腕、颈的连接标签）落在与武生几乎相同的位置 → **`pivots.json` 铆点标注可以整份直接复制迁移，零调整**。参考实现里悟空、红孩儿共 22 件全靠这招零标定迁移。

### 2.5 部件清单

- **人形 11 件**：`head`（头茬，侧脸朝左）、`chest`（胸+肩）、`belly`（下摆战裙）、`upper_arm_f`/`lower_arm_f`/`hand_f`（前臂三段）、`upper_arm_b`/`lower_arm_b`/`hand_b`（后臂三段，**色调更暗**以区分前后景深）、`leg_f`/`leg_b`（两腿）。可选 `hand_fist`（侧面握拳件，用于拳击连招）。
- **每件都要留素皮铆位**：连接处画成"一块无雕花的圆头素皮标签，中间一个铆孔"。提示词 `plain uncarved rounded leather tab where a rivet would attach`。这是铰接的物理接口。
- **老虎 7 件**：`tiger_head`/`tiger_body`（躯干，**关键**：提示词让它在颈、尾、腹线四个腿位都留铆位标签）/4 条腿/`tiger_tail`。
  - **付过学费的坑**：如果提示词说"无腿的躯干"，模型会画一个"带四个腿桩 + 铆孔的躯干"当作接口——**这其实正合皮影工艺**，让四条独立腿件挂上去即可。但如果你既让躯干带腿、又单独生成腿，就会出现"六条腿"。务必：躯干只留**铆桩接口**，腿是独立件。

### 2.6 关键提示词全文（可直接用）

**STYLE（所有件共用的风格前缀）**：
```
A single isolated piece of a traditional Chinese shadow puppet (pi ying), ONE
puppet body part only, NOT a whole figure. Strict front-facing flat orthographic
view like a scanned museum artifact: zero perspective, zero shading, zero
highlights, zero 3D effect, zero cast shadow. Style of dyed translucent cowhide
leather with fine intricate openwork carving (scroll patterns, wave lattice,
snowflake lattice), crisp ink-dark cut outlines, traditional palette of deep
crimson red, emerald green, ochre yellow and ink black on warm parchment-toned
leather. The ENTIRE background is one flat solid uniform magenta color (#FF00FF)
with no gradient, and every carved-out opening INSIDE the leather piece also
shows the same flat magenta through the hole. Original design, not copied from
any existing artwork. No text, no watermark, no border, no frame.
```

**部件描述示例**（`head`，其余照此格式，强调朝向 LEFT、留铆位、只此一件）：
```
The head piece (tou cha) of a young heroic martial-arts male character: side
profile facing LEFT, elegant carved facial features in the classic openwork
style, black hair bun with a short crimson headband tail, small ochre hat crown.
Includes the neck stub below the chin, ending in a plain uncarved rounded leather
tab where a rivet would attach. The piece fills most of the frame.
```
（完整 11+7 件描述见参考实现 `tools/gen_puppet_parts.py` 的 `PARTS`/`PARTS_TIGER`/`CHAR_VARIANTS`，可整体搬运。）

---

## 3. 后处理：品红抠图 → 矢量化 → 贴图三件套

输入 `tools/raw/part_<name>.png`（品红底原图），输出到 `assets/puppets/<set>/`：
- `geometry.json`：所有部件的 `{outline(归一化多边形), bbox}`。
- `<name>_dye.png`：染色贴图（RGB）。
- `<name>_alpha.png`：完整 alpha（外轮廓 + 雕孔镂空都透明）。

**处理步骤**（用 numpy/scipy/skimage）：
1. **品红抠图**：算每像素到 `#FF00FF` 的色距，`<170` 判为透明。再做**去溢色**：品红边缘的半透明像素把红蓝分量往绿分量压，消除紫边。
2. **去噪**：清掉 `<96px` 的孤立小连通域；反向补掉件身内部 `<48px` 的针孔。
3. **外轮廓矢量化**：取最大连通域 → 填孔 → `skimage.measure.find_contours` → **Douglas-Peucker 简化**（闭合轮廓要特殊处理：去掉重合尾点，从点 0 和最远点拆成两条开链分别简化）→ 归一化到 `[0,1]` → 保证逆时针。
   - **numpy 坑**：numpy 2.x 移除了 2D `cross`，自己写 `v[...,0]*w[...,1]-v[...,1]*w[...,0]`。
4. **孔区颜色填充**：dye 贴图的透明区用最近不透明像素的颜色填充（`distance_transform_edt`），避免贴图采样时溢出品红。

**运行时如何变成 3D 厚片**：在 Three.js 里用 `outline` 建 `THREE.Shape` → `ExtrudeGeometry`（厚度约 2mm）→ 材质用 `dye` 做 map、`alpha` 做 alphaMap + `alphaTest`（把雕孔和外形一起镂空）+ `MeshPhysicalMaterial` 的 `transmission` 做皮革透光。

---

## 4. 影人绑定与装配（无骨骼蒙皮，纯铰链树）

**核心理念**：皮影不需要蒙皮/权重。每个部件是一个刚性厚片，挂在父部件的铆点上，只能绕铆点旋转。整套人 = 一棵 `THREE.Group` 铰链树。

### 4.1 pivots.json 语义（每个部件一条）

```jsonc
{
  "belly": {                    // 骨盆/下摆 = 根部件
    "parent": null,
    "pivotInParent": [0, 0],
    "pivotInSelf": [0.5, 0.068],// 本件图上的铆点（归一化 UV，原点左上，y 向下）
    "height": 0.185,            // 世界高度（米）——图高 1 映射到这个米数
    "limits": [-15, 15],        // 关节角限位（度）
    "layer": 0                  // 前后叠压层序（决定 z 微偏移，见下）
  },
  "chest": {
    "parent": "belly",
    "pivotInParent": [0.5, 0.068], // 铆点在【父件】图上的位置
    "pivotInSelf": [0.5, 0.752],   // 同一铆点在【本件】图上的位置
    "height": 0.185, "limits": [-25, 25], "layer": 1
  },
  "hand_f": {
    "parent": "lower_arm_f", "pivotInParent": [0.5,0.895], "pivotInSelf":[0.48,0.1],
    "height": 0.075, "limits": [-45,45], "layer": 5,
    "art": "hand_b",           // 借用另一件的画稿（前手复用后手图）
    "flipX": false             // 是否水平镜像（调转虎口朝向）
  }
}
```

**装配算法**：
- 建件时，把网格平移使 `pivotInSelf` 对齐关节组原点。
- 挂到父件时，关节组的位置 = `(pivotInParent − parentPivotInSelf) × parentHeight`，用**父件同一个铆点**在父/子两张图上的坐标差，把两件铆点对齐。
- `layer` 决定 z 微偏移（`layer × 0.0007`），实现前后叠压（后臂在身后、前臂在身前）。

### 4.2 三条绑定血泪教训

1. **转身后要翻 z 符号**。角色左右转向（绕 y 转 180°）后，前后关系反转，`layer` 的 z 偏移符号必须取反，否则部件错层、后臂盖到身前。判据：`zSign = root.rotation.y > π/2 ? -1 : 1`。
2. **前手用握拳/借稿件，前手不镜像、后手镜像**。前后手复用同一张手稿时，靠 `flipX` 区分朝向（后手 `flipX:true`）。
3. **头件层序放在胸甲后方（卡领）**。头的 `layer` 设成比胸甲小（如胸甲=1、头=0.5），让脖子从领口**后方**插入，形成真皮影的"卡领"叠压。否则脖子只能盖在领口上，出现断层感。（这一条是标定阶段才发现的，见第 8 章。）

### 4.3 部件之间会有真实空隙——要主动叠压

生成的胸甲下缘铆点和下摆上缘铆点之间会有几厘米真实空隙，铰接工艺的连接桩会**裸露在空隙里很难看**。解法有二，配合用：
- 把上层件（胸甲）的 `pivotInSelf` 下移，让它的下摆**盖住**下件的腰（叠压）。
- 在 `pivots.json` 里给部件加 `erase` 连接桩擦除区，加载时把该区域在 alpha 贴图上**涂透明**（参考实现里虎躯干 6 处、虎头、三套胸甲颈桩都这么遮；见第 8 章标定）。
  - **擦除别过度**：虎颈皮本身是连接件，整片擦掉会让头身之间断开成透明——只擦铆点周围，别擦连接皮。

---

## 5. 彩色透光投影（3D 核心奇观）

这是"每一帧都是 3D 光学模拟"的技术兑现。**不要用假阴影贴图**。算法：

1. **分层**：影人本体和光锥尘埃等放在 **layer 1**；主相机看 layer 0（舞台木框、灯），一个专门的**灯位相机**只看 layer 1。
2. **灯位相机渲染到 RT**：在灯的位置放一个 `PerspectiveCamera`，`lookAt` 幕心，FOV 刚好覆盖幕布，把影人层渲进一张 RenderTarget。
   - **坑**：`scene.background` 会覆盖 RT 的透明底 → 渲染前置 `scene.background = null`，渲染后还原。
   - **坑**：灯光是 layer 过滤的 → 给灯光 `.layers.enable(1)` 否则影人全黑。
   - **坑**：皮革材质的 `transmission` 在透明 RT 里会渲成黑 → 投影 pass 期间临时把 `transmission` 设 0（用 `before/after` 钩子），投完还原。
3. **按距离景深模糊**：分离式高斯模糊（横竖两 pass），半径正比于影人到幕布的平均深度——**贴幕则锐、近灯则虚**，这是真实皮影的光学签名。
4. **幕布 shader**：把模糊后的影子与暖白幕布**相乘**（皮色 × 透光率），叠一个灯心热区高光。
   - **坑**：幕布法线朝 -z 且绕 y 转了 180°，采样 RT 时 u 要翻转 `uv.x = 1.0 - vUv.x` 才对齐灯位相机视角。
   - **补充**：用 `gl_FrontFacing` 给幕布分正背面——正面是亮子，背面输出暗色素背衬（幕后模式用，见第 7 章）。
5. **布景/道具的摆位要算投影落点，不凭感觉摆**（付过学费）：影子的落点由「灯→物→幕」的光学关系决定，贴地放的布景影子可能被灯位压出幕布下缘，正面只见个尖。两条规律：
   - **贴地物体要贴幕放**（z→0）：它的影子基部必然落在幕下缘地面处，与枯树等地平线参照对齐，不会悬空。
   - **吊景抬高避让表演区**（如酒旗悬于头顶、山石吊高位），别挡影人的戏。
6. **不想进影子的东西只挂 layer 0**（如操纵杆、标注）：layer 1 的一切都会被灯位相机投进幕布。

舞台坐标常量（参考值）：`SCREEN_W=1.8, SCREEN_H=1.2, SCREEN_CY=1.1`（幕心高），`LAMP_POS=(0, 1.1, 0.85)`（灯在幕后 0.85m）。

---

## 6. 手势控制系统（含全部血泪教训——最重要的一章）

> 这一章是整个项目**反复迭代、付学费最多**的地方。控制系统的定型架构和每条约定都是被推翻重来过的。请严格遵循，不要"优化"回被否定的方案。

### 6.1 顶层哲学（作者拍板，不可动摇）

- **能自动化的全自动化，让人 3 秒上手**。用户只做简单动作，系统自动呈现丰富表演。
- **手势 = 状态，状态 = 循环动画**。每个手势对应一个角色状态，每个状态自带循环动作。
- **放弃打击感/甩手识别**。作者明确否决了"挥拳识别击打"这条路——来回挥拳会被误判为前后走路，且识别不稳。改为：握拳=拳脚连招循环（握拳时微微前后移动即可，**不识别打击力度**），程式化呈现。这条踩了很久，不要重蹈覆辙。

### 6.2 手势表（最终定型）

| 手势 | 状态 | 表现 |
|---|---|---|
| 五指张开 | 亮相 | 对观众持续挥手（连续动画）|
| 握拳 | 拳脚连招 | 直拳→抢拳→踢腿→弓步循环 |
| 剑指（食+中指）| 器械套路 | 持哨棒/金箍棒：高劈→侧扫→前刺→环绕 |
| 单伸食指 | 指向 | 前手指向任意方向（IK，360°）|
| 竖拇指 | 傲立 | 叉腰扬后手 |
| 手掌移动 | 走/跑 | 按净位移自动判定，微晃不动 |
| 快速上提/下压/大幅甩手 | 跳/蹲/转身 | 按手掌运动幅度自动 |

### 6.3 识别层的三条铁律（`gestures.ts` / `mediapipe.ts`）

1. **比率分母必须用"掌长"，不能用整手包围盒**。手势分类靠"各指尖到腕的距离 ÷ 掌长"，掌长 = 腕→中指根的**单段**距离。
   - **付过学费**：若分母用整手包围盒或"掌长+掌宽之和"，握合时包围盒缩水 → 所有比率失真 → 一直被识别成握拳。
2. **握拳要做"粘滞"（迟滞）**。进入握拳阈值（比率 <1.12）比退出（<1.32）更严，避免自然半握与握拳来回抖动。再加 0.12s 去抖。
3. **深度基准要用掌长且稳定后才锁**。判断影人远近（靠近灯放大）用掌长对比一个**稳定 0.4s 后才锁定**的基线，缓慢自适应漂移，避免手一入镜就瞬移。

### 6.4 运动层（`director.ts`）

- **走路用带方向的净速度 EMA**，不是速率。来回晃手净位移≈0 → 不走；持续朝一个方向才走。**踩过的坑**：用速率会把挥拳抖动误判成走路。
- **跳跃用腕纵向原始速度**触发，带锁定窗口防连跳。
- **转身用持续位移 + 1 秒锁定**。**踩过的坑**：翻手会瞬间触发左右转 + 闪现故障 → 加持续判据和锁定窗口。

### 6.5 姿势层：FK 优先，IK 只留两处（关键教训）

> **这是最反直觉、但最重要的一条**：预设姿势/连招**一律用 FK 直接给角度**（`u`=抬臂角，`e`=肘弯角），**绝对不要用 IK 去摆预设姿势**。

- **为什么**：用 IK 表达预设姿势是"手臂反复扭曲、姿势看着像坏了"的**根本原因**。IK 求解有多解、会跳变，摆固定造型时纯属自找麻烦。参考实现在这里做过一次系统性重构（IK→FK），一切扭曲问题随之消失。
- **IK 只用于两处**：①单伸食指的"指向"（手要跟随目标点）；②器械模式的手签跟随。其余全 FK。
- **FK 角度约定**（标定验证过，别自己推）：`u=0` 手臂下垂，`u=90` 水平指向面向侧，`u=180` 竖直上举；`e` 是肘部向身后折弯角。应用时 `targetU = -(u)`、`targetE = -(e)`，带平滑插值（`dt×14`）防跳变。
- **IK 求解器**（`ik.ts`，纯函数 + 单测）：两骨解析解 `solveTwoBone(L1,L2,target,elbowSign)`，带**臂展环带钳制**（目标半径限制在 `[0.35, 0.97]×臂展`，让对折退化解在数学上不存在）+ **"肘永远朝身后"**的选解规则（带迟滞防两解接近时跳变）。
   - **踩过的坑**：用"肘更低"当选解启发式会给出错误解；改成"肘永远朝身后"（人体/皮影侧面像的肘尖始终向后）才对。

### 6.6 坐标系/方向问题的正确解法（血泪总结）

> **凡是涉及方向、朝向、角度符号的问题，不要靠解析推导，一律做可视化标定工具让人眼确认。**

参考实现里，前手/后手朝向、`u`/肘的符号，被解析推导错了 N 次，每次自以为对、一测又错。最后的教训是：**建一个标定模式**（方向键切换预设姿势、屏幕显示当前姿势名），让人肉眼核对"脸朝哪、该手臂实际指向哪"，用眼睛一次性定死符号。别在坐标系符号上跟数学较劲。见第 8 章。

---

## 7. 场景与玩法

**场景路由**：`?scene=shuihu`（默认，武松打虎）/ `?scene=xiyou`（悟空打红孩儿）。

**武松打虎**：
- 老虎 7 件资产，`tiger.ts` 独立 AI（对峙、扑击、咆哮、扑地伏诛），也可由**第二只手**手势控制（掌=走位/握拳=扑击/张开=咆哮）。无第二只手时 AI 接管。
- 命中判定：连招攻击拍的力度峰值 + 面向 + 射程（棒 0.5m / 拳 0.3m）。
- 玩法链：剑指持哨棒 → 哨棒打枯树两下 → **树倒棒断**（水浒原著还原）→ 剑指自动降级为拳脚 → 打虎 HP 归零伏诛。
- 音效：锣=命中、太鼓=出招、吼=扑击/咆哮、断木=断棒；虎伏诛配双声降调大锣。

**悟空打红孩儿**（`?scene=xiyou`）：
- 悟空、红孩儿都是人形（借布局参照生成，见 2.4）。双手入镜=两个角色各由一只手控制。
- 金箍棒染金、**双手握棒**（后手 IK 握到棒线上，见下）；红孩儿持火尖枪。
- 张开手 → 红孩儿**三昧真火**喷火粒子（从嘴部喷出）；跳跃 → 悟空**筋斗云**。
- 通用受击/败阵/胜利谢幕演出（受击 flail+击退、败阵倒地、胜利亮相→躬身→挥手）。

**双手握棒的正确实现**（付过学费）：不要在导演层手推坐标系变换（反复算错符号）。正确做法是**在 assembly 层用 Three.js 场景图矩阵**解：前臂 FK 定格后，取棒线上的目标握点的**世界坐标**，用后肩父节点的 `worldToLocal` 变换到后肩局部系，再解 IK。场景图矩阵天然处理面向镜像/胸倾/肩偏，不会错符号。再加"可达性自适应"：握点超出后臂臂展时沿棒线回退到够得着处，避免手悬空。

**筋斗云贴脚**（付过学费）：云的高度**不能写死偏移**。要动态跟随脚底：`云y = 髋关节y − cos(腿摆角) × 当前腿长`。腿在跳跃时是蜷起来的（脚抬高），且腿长可被标定缩放，写死偏移必然对不上脚。

**传统布景上台**（`props.ts`）：酒旗、山石、火云洞等真皮影戏台的布景件，用与影人相同的生成/抠图管线产出，按场景（水浒/西游）各配一份 `PropPlacement` 清单。摆位遵循第 5 章的投影落点规律：贴地物贴幕放、吊景抬高避让表演区。

**操纵杆按真实持法做**（调研结论「签子掌得平」）：人形三杆——主杆在颈后、双手各一签；杆近水平、垂直幕布指向操偶师傅。兽形同制：老虎两根杆（身一根、头一根）。操纵杆只挂 layer 0（不进影子）。

**开场报幕**（`opening.ts`）：资产加载完后播一次——幕全暗 0.6s → 灯 1.2s 渐亮 → 一声锣 + 皮影风字幕牌停留后淡出 → 开演。时序抽成纯函数 `openingTimeline(t)` 配单测；报幕期间用 `done` 门闩挂起导演/手势输入（手势帧丢弃，防开演瞬移）。`r` 重开不重播，换幕整页重载天然重播。

**幕后模式**（`backstage.ts`，按 `b`）：机位约 1s 平滑绕到幕侧后 45°，左键拖拽绕台心球坐标环绕、滚轮缩放——直观展示皮影工作原理：灯·点光源、幕布·亮子、3D 铰链皮偶、三根操纵杆，可加投影原理标注。幕后时幕布背面输出暗色素背衬（见第 5 章 `gl_FrontFacing`），投影照常渲染、手势表演不中断；再按 `b` 平滑回前台。

**换幕**：按 `c` 在水浒 ↔ 西游之间整页重载切换（保留 debug 参数，对局状态清零）；按 `r` 重开当前对局。

---

## 8. 标定工具哲学（本项目最有价值的方法论）

> **当你的几何/坐标推理连续失败时，不要继续推导——построй一个可视化标定工具，让人把标记拖到正确位置。**

参考实现里，火源位置、握棒点、连接桩遮罩、头部插领深度、手臂/腿比例，靠猜和算很难得到正确值。最终的通解是一个**拖点标定模式**（按 `t` 开启）：

- 按 `t` 时，画面**定格成专门的标定摆位**（角色持棒定势、持续喷火），手势和战斗逻辑暂停——**静止画面下才好拖**。
- 屏幕上叠加可拖动的标记点（🔥嘴部火源 / ✊握棒点 / 👤头部位置 / 💪臂长 / 🦵腿长）。
- 用户拖到正确位置，数值**实时生效**、存入 `localStorage`、面板显示当前数值。
- 用户把满意的数值报给开发者，**固化为代码默认值**。

实现要点：
- 拖动时用相机反投影，把屏幕点投到部件所在的 z 平面得到世界坐标，再换算成对应参数（相对偏移/沿棒线投影距离/关节树缩放比）。
- 比例调整（臂/腿）是**关节树整体缩放**：`joint.scale.setScalar()`，同时同步 IK 段长；腿加长时 root 上移补偿保持贴地；挂在手上的棒要反向缩放避免跟着变短。
- 贴图 URL 带版本号 `?v=时间戳` **防浏览器缓存**——否则改了 alpha 贴图"看起来没生效"，其实是浏览器用了旧缓存（这个假象浪费过时间）。

这套"拖→即时生效→报数→固化"的循环，是解决一切"只有人眼能定的位置/比例"问题的银弹。**强烈建议 Kimi Code 早期就把它建起来**，会省掉大量来回。

---

## 9. 里程碑与验收

| 里程碑 | 交付 | 验收标准 |
|---|---|---|
| **M0 舞台** | theater + projection | 幕布上能看到一个静态影人的彩色透光影，近灯虚、贴幕锐 |
| **M1 资产管线** | gen + postprocess 跑通 | 生成 1 套 11 件人形，风格一致、雕孔透光、铆位对齐 |
| **M2 装配** | assembly + pivots | 影人各部件正确铰接，能整体走位、手臂 FK 摆姿势不扭曲 |
| **M3 控制** | mediapipe + gestures + director | 摄像头手势稳定切换 5 种状态，走跳自动，3 秒上手 |
| **M4 场景** | 武松打虎完整玩法 | 打树断棒、打虎伏诛、音效命中判定齐全 |
| **M5 西游** | 悟空打红孩儿 | 双手双角色、火/棒/云/谢幕齐全 |
| **M6 破幕**（可选高潮）| 幕布撕裂 + 3D 皮偶特写 | 手势触发影人破幕跃出，从彩影变立体皮偶冲镜头 |
| **M7 打磨** | 标定固化 + 传播视频 | 比例/位置全部标定到位（标定参数中心 + localStorage），录制 case 视频 |
| **M8 体验打磨** | 开场报幕 + 幕后模式 + 传统布景 + 操纵杆 | 报幕时序成立、幕后环绕可看三杆与投影原理、布景按投影落点摆位 |

（参考实现现状：M0–M5、M7、M8 已完成；M6 破幕未做，底子全在，留作后续。）

**M6 破幕**是设计里的第三幕高潮、也是传播视频第 1 秒的钩子（"你以为是 2D…"揭底）。所有底子都现成：影人本就是真 3D 铰链件（破幕后直接换镜头拍本体，零新增资产）、粒子系统现成（火焰改配色即纸屑）、音效现成（撕纸+大锣）。实现：胜利后解锁 → 快速前推手掌触发 → 幕布撕裂 shader + 碎片粒子 → 相机穿幕推进，影人从投影变立体皮偶亮相。

---

## 10. 踩坑百科（避坑清单，逐条都付过学费）

**资产/生成**：
- [ ] Azure 请求前必须绕开本机代理（`NO_PROXY="*"` 等），否则挂死。
- [ ] 提示词必须强调"单件、正视平面、零光影、品红底且雕孔露品红"，缺一不可。
- [ ] 批量生成必须并发 2 + 指数退避（10 RPM 限速）。
- [ ] 老虎躯干只留铆桩接口、腿是独立件，否则"六条腿"。
- [ ] 换角色用"同名部件作布局参照"，铆点标注可零调整迁移。

**后处理**：
- [ ] numpy 2.x 无 2D `cross`，自己实现。
- [ ] 闭合轮廓的 RDP 要拆成两条开链，否则退化。
- [ ] dye 贴图孔区要用最近邻颜色填充，防采样溢出品红。

**投影**：
- [ ] 投影 pass 前 `scene.background = null`，后还原（否则黑屏）。
- [ ] 灯光 `.layers.enable(1)`（否则影人全黑）。
- [ ] 投影 pass 期间材质 `transmission = 0`（否则透光渲成黑）。
- [ ] 幕布采样 RT 时 u 翻转（法线朝向 + 180° 旋转）。
- [ ] 布景摆位算投影落点：贴地物贴幕放（z→0，影子基部落地面），吊景抬高避让表演区——贴地放的山石影子会被压出幕下缘只见山尖。
- [ ] 不想进影子的东西（操纵杆、标注）只挂 layer 0，layer 1 的一切都会被投上幕。

**绑定**：
- [ ] 转身后 `layer` 的 z 偏移符号取反（防错层）。
- [ ] 头件层序放胸甲后方（卡领，防脖子断层）。
- [ ] 部件真实空隙里的连接桩：叠压 + `pivots.json` 的 `erase` 区涂透明；但别擦掉连接件本身（虎颈皮擦过头会头身断开）。
- [ ] 换了画稿（重新生成的部件图）必须重标铆点——新稿的肩桩等连接位会移动，沿用旧标注手臂会脱离。
- [ ] 武器件的方向要目验（火尖枪枪头应朝外 -y，曾画成朝向身体）。

**控制（最容易走回头路）**：
- [ ] 预设姿势/连招**一律 FK**，IK 只留指向/手签——IK 摆姿势是扭曲的根因。
- [ ] 手势比率分母用"掌长单段"，不用包围盒。
- [ ] 握拳做迟滞 + 去抖。
- [ ] 走路用带方向净速度，不用速率（防挥拳误判走路）。
- [ ] 转身用持续位移 + 锁定窗口（防翻手瞬移）。
- [ ] IK 选解规则"肘永远朝身后" + 臂展环带钳制。
- [ ] **放弃打击力度识别**——握拳连招程式化呈现即可。
- [ ] 方向/符号问题一律用可视化标定定，不靠解析推导。

**标定/运行时**：
- [ ] 贴图 URL 带 `?v=时间戳` 防缓存（否则改图"没生效"的假象）。
- [ ] 双手握棒在 assembly 层用场景图矩阵解，不在导演层手推坐标。
- [ ] 筋斗云高度动态跟随脚底（含腿摆角 + 腿长缩放）。
- [ ] 标定模式要**定格画面**再让人拖（动着的角色没法拖）。
- [ ] 开场报幕期间用门闩挂起手势输入（帧丢弃），否则开演瞬间影人瞬移。
- [ ] 幕后模式幕布背面用 `gl_FrontFacing` 输出暗背衬，别和正面亮子共用颜色。

---

## 附录 A：命令速查

```bash
# 开发
npm run dev                        # Vite 开发服务器
npm test                           # Vitest（IK 求解器单测）

# 资产生成（务必绕代理）
NO_PROXY="*" no_proxy="*" HTTPS_PROXY= https_proxy= \
  python tools/gen_puppet_parts.py --set wusheng          # 生成武生 11 件
python tools/postprocess_puppet.py --set wusheng --size 512
python tools/gen_puppet_parts.py --set wukong             # 悟空（借武生布局参照）
python tools/gen_puppet_parts.py --set tiger              # 老虎 7 件

# 音效（freesound，凭证 ~/.freesound.env）
python tools/freesound_fetch.py

# 调试
?debug=mouse   # 无摄像头：鼠标模拟手（移动=走位、滚轮=远近、p=切手势、左拖=指向）
?debug=calib   # 姿势方向标定（方向键切换预设姿势，肉眼核对朝向）
按 t 键         # 拖点标定模式（定格 + 拖火源/握棒/头/臂/腿）
按 b 键         # 幕后模式（环绕看灯/幕/影人/三根操纵杆 + 投影原理标注）
按 c 键         # 换幕（水浒 ↔ 西游，整页重载）
按 r 键         # 重开当前对局
```

## 附录 B：凭证文件

- `~/.azure-image.env`：`AZURE_IMAGE_ENDPOINT` / `AZURE_IMAGE_DEPLOYMENT` / `AZURE_IMAGE_KEY` / `AZURE_IMAGE_API_VERSION`
- `~/.freesound.env`：`FREESOUND_CLIENT_ID` / `FREESOUND_API_KEY`
- **发布注意**：freesound 的 CC-BY 音效必须保留 `assets/sfx/*/` 里的署名侧车文件，发布时列出署名清单。

---

## 附录 C：给 Kimi Code 的建议推进顺序

1. **先搭 M0 舞台 + 一个假影人（占位色块）跑通投影**——先看到彩色透光影，验证光学核心，再谈资产。
2. **早早建 `?debug=mouse` 鼠标调试源和 `t` 拖点标定**——没摄像头也能开发，且标定省掉海量来回。
3. **资产管线先只生成 1 套人形跑通全链路**，别一次生成所有角色。
4. **控制系统严格按第 6 章，尤其"FK 优先、放弃打击识别"**——这两条是最容易凭直觉走回头路的。
5. **遇到方向/位置/比例定不准，立刻建标定拖点，别硬算。**

祝顺利。这套架构已被完整验证过一遍，照着走能少走我们走过的所有弯路。
