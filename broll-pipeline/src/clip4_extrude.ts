// 工序 04：只呈现「头茬单件」变成三维薄片。
// 2D 平片(正视) → 挤出 2mm → 侧转露出厚边 → 定住微转。
// 全程只有头茬一件——无缩放、无阵列、无相邻部件、无标注文案。
// 时间线（60fps · 360 帧 = 6.0s）：
//   0.00–~0.9s  平片正视（厚度≈0）
//   ~0.9–2.9s   挤出 + 侧转露厚边（高潮段，下游窗口取 1.0–2.9s = 帧 60–174）
//   2.9–6.0s    定住 3/4 视角 + 极缓微转
import * as THREE from 'three';
import type { ClipCtx } from './main';
import { buildSinglePart } from './puppet3d';
import { makeStage } from './three_scene';
import { CLIP_FRAMES, CLEAN, seg, easeInOut, easeOut, lerp, clamp01, setCaption, setStat, type Clip } from './common';

const HEAD_MAX = 0.42;    // 头茬归一化后最大边（米）——单件 hero，占满画面主体
const REVEAL_ROT = -1.05; // 侧转露厚边目标角（≈ -60°：正面纹样 + 2mm 断面同时可见）
const THIN = 0.00002;     // 平片起始厚度（≈0，读作一张纸）
const THICK = 0.002;      // 挤出到 2mm

// 高潮段落在 1.0–2.9s（帧 60–174）：挤出略早于 60 起势、侧转在窗口内走完弧线
const GROW_A = 54, GROW_B = 140;  // 挤出长厚区间
const TURN_A = 58, TURN_B = 166;  // 侧转区间（在 174 前走完，留余量落定）

export async function create(c: ClipCtx): Promise<Clip> {
  const { gl, assets, ctx, W, H } = c;
  const stage = makeStage(gl);

  // 单件头茬。把几何自身居中到原点（含 z 中面）→ 侧转绕真实中心轴、无横向漂移；
  // 挤出以中面对称长厚。mesh.scale.xy 保留 def.height，scale.z 逐帧驱动厚度。
  const sp = await buildSinglePart(assets, 'head');
  const head = sp.mesh;
  head.geometry.computeBoundingBox();
  const bb = head.geometry.boundingBox!;
  head.geometry.translate(
    -(bb.min.x + bb.max.x) / 2,
    -(bb.min.y + bb.max.y) / 2,
    -(bb.min.z + bb.max.z) / 2,
  );
  head.position.set(0, 0, 0);

  const group = new THREE.Group();
  group.add(head);
  group.scale.setScalar(HEAD_MAX / Math.max(sp.size.x, sp.size.y));
  stage.scene.add(group);

  const frames = CLIP_FRAMES[4];

  return {
    frames,
    seek(frame: number) {
      // 挤出：平片 → 2mm（对中面对称长厚）
      const grow = easeOut(clamp01(seg(frame, GROW_A, GROW_B)));
      head.scale.z = lerp(THIN, THICK, grow);

      // 侧转：正视 → 3/4 露厚边；落定后极缓微转「定住」
      const turn = easeInOut(clamp01(seg(frame, TURN_A, TURN_B)));
      const idle = frame > TURN_B ? Math.sin((frame - TURN_B) * 0.03) * 0.02 : 0;
      group.rotation.y = REVEAL_ROT * turn + idle;

      // 相机：单件居中定框，全程不动（无拉远、无缩放）
      stage.frame(0, 0, 0.27);
      stage.render();

      // 无任何标注 / 阵列 / 相邻部件。clean 下 overlay 由 CSS 整块隐藏；这里清空 2D 层。
      ctx.clearRect(0, 0, W, H);
      if (!CLEAN) {
        setCaption('头茬：正视 → 挤出 2mm → 侧转露厚边　<span class="mono">depth = 0.002 m</span>');
        setStat('<div><span class="big">1</span><span class="unit"> / 1</span></div><div class="unit">头茬 · 已挤出厚片</div>');
      }
    },
  };
}
