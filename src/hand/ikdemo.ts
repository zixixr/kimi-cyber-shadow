// 「IK 直控演示模式」（?ikdemo=1）的纯映射函数（无 three / DOM 依赖，可单测）。
//
// 还原早期失败方案：食指 + 拇指模拟两根签杆，分别「直控」角色两只手（IK 目标），无状态机。
//   - 主手食指指尖 → 前手 IK 目标；拇指指尖 → 后手 IK 目标（两根签杆的隐喻）。
//   - 把摄像头归一化坐标转到影人局部臂长空间；缩放取「指尖活动范围 ≈ 手臂可达环带」量级：
//     手指小幅动作 → 手臂明显移动，但目标常被 ik.ts 环带钳制在臂展内 →「伸展不开」的别扭真实出现。
//   - 直控，不加噪声、不做平滑/包络（那是 capture.ts 里离线 B-roll 脚本干的事，本模式要真实手感）。
//
// 目标点约定 = 影人局部系（肩为原点，y 向上，+x=身后；Puppet.pointAt / director.point 同款）。
// 观众视角方向 → 局部：local.x = -观众x·facing（facing=1 面向观众右=局部 -x），与 director 一致。

import { INDEX_TIP, THUMB_TIP, WRIST } from './mapping';
import type { HandSignal, NormPoint } from './source';

/** 指尖活动→臂长空间增益：小 = 迟钝，大 = 一点手指动作甩出满臂位移（本模式故意取大）。 */
const CAM_GAIN = 0.55;
/** 鼠标调试路径增益（?debug=mouse：输入是 [-1,1] 绝对屏幕点，量级不同，用小增益）。 */
const MOUSE_GAIN = 0.1;

/** 前/后手在局部系的基准落点（肩下方；前手偏身前 -x、后手偏身后 +x，侧面像才不糊成一条臂）。 */
const FRONT_BASE: NormPoint = { x: -0.05, y: -0.1 };
const BACK_BASE: NormPoint = { x: 0.06, y: -0.09 };

/** 指尖相对腕的「标称」向量（手自然竖起时）：减掉它让手指的「增量」绕基准点驱动，而非被常量拽偏。 */
const INDEX_NOMINAL: NormPoint = { x: 0.0, y: 0.3 }; // 食指竖起在腕正上方
const THUMB_NOMINAL: NormPoint = { x: 0.2, y: 0.12 }; // 拇指偏侧、略低

/** 无手可识别时双臂垂下的静默目标（IK 到肩下低位）。 */
const HANG_FRONT: NormPoint = { x: -0.05, y: -0.12 };
const HANG_BACK: NormPoint = { x: 0.05, y: -0.12 };

/** 一帧的两臂 IK 目标（影人局部系） */
export interface IkDemoTargets {
  front: NormPoint;
  back: NormPoint;
}

/**
 * 观众视角的指尖向量 → 影人局部 IK 目标点（直控，不钳制——环带钳制交给 ik.ts 求解器）。
 * @param vx,vy  指尖相对腕的向量（观众视角：x 右正、y 上正）
 * @param nom    该手指的标称向量（减去后只留「手指怎么动」的增量）
 * @param base   该手臂的基准落点（局部系）
 * @param gain   指尖→臂长空间增益
 */
function toLocal(vx: number, vy: number, facing: 1 | -1, nom: NormPoint, base: NormPoint, gain: number): NormPoint {
  return {
    x: -(vx - nom.x) * facing * gain + base.x,
    y: (vy - nom.y) * gain + base.y,
  };
}

/**
 * 主手手信号 → 两臂 IK 目标。
 *  - 摄像头（有 landmarks）：真·食指尖 lm[8] / 拇指尖 lm[4] 相对腕 lm[0]（两根签杆本体）。
 *  - 鼠标调试（landmarks 为 null，?debug=mouse）：拖动点=前手、鼠标位置=后手，
 *    仅用于无摄像头时验证「两个独立 2D 输入各驱一臂」的直控管线（非真实手感）。
 * @param s      主手信号；null（无手）→ 双臂垂下
 * @param facing 影人面向（本模式恒为 1）
 */
export function ikDemoTargets(s: HandSignal | null, facing: 1 | -1): IkDemoTargets {
  if (!s || !s.present) return { front: { ...HANG_FRONT }, back: { ...HANG_BACK } };

  if (s.landmarks) {
    const w = s.landmarks[WRIST];
    const idx = s.landmarks[INDEX_TIP];
    const thb = s.landmarks[THUMB_TIP];
    return {
      front: toLocal(idx.x - w.x, idx.y - w.y, facing, INDEX_NOMINAL, FRONT_BASE, CAM_GAIN),
      back: toLocal(thb.x - w.x, thb.y - w.y, facing, THUMB_NOMINAL, BACK_BASE, CAM_GAIN),
    };
  }

  // 鼠标调试路径：两个绝对屏幕点各驱一臂（标称取 0，绝对点直接进映射）
  const zero: NormPoint = { x: 0, y: 0 };
  return {
    front: toLocal(s.indexTip.x, s.indexTip.y, facing, zero, FRONT_BASE, MOUSE_GAIN),
    back: toLocal(s.wrist.x, s.wrist.y, facing, zero, BACK_BASE, MOUSE_GAIN),
  };
}
