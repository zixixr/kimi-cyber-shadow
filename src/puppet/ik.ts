// 两骨解析 IK 求解器（纯函数，无 three 依赖，可单测）。
// 坐标约定：求解器工作在 2D 屏幕系（y 向下），肩为原点；
// 返回两段骨骼各自相对 +X 轴的绝对角度（弧度）。
// 文档 6.5 三条要点全部在此：
//  ① 臂展环带钳制：目标半径限制在 [0.35, 0.97]×(L1+L2)，对折/伸直退化解在数学上不存在；
//  ② 选解规则「肘永远朝身后」（皮影侧面像肘尖始终向后，+x 一侧），不要用「肘更低」；
//  ③ 两解接近时带迟滞，保持上一次选择，防逐帧跳变。

export interface TwoBoneSolution {
  /** 大臂相对 +X 轴的绝对角（弧度） */
  shoulder: number;
  /** 小臂相对 +X 轴的绝对角（弧度） */
  elbow: number;
}

/** 环带钳制的内/外半径系数（相对臂展 L1+L2） */
export const ANNULUS_IN = 0.35;
export const ANNULUS_OUT = 0.97;

/** 迟滞宽度：两解肘尖 x 差小于该比例×臂展时，维持上一次选解 */
export const ELBOW_HYSTERESIS = 0.05;

/**
 * 把目标点钳制到臂展环带 [ANNULUS_IN, ANNULUS_OUT]×(L1+L2) 内。
 * 方向保持原方向；目标几乎压在肩原点（方向无定义）时取 +x 方向。
 */
export function clampToAnnulus(
  L1: number,
  L2: number,
  target: { x: number; y: number },
): { x: number; y: number } {
  const reach = L1 + L2;
  const r = Math.hypot(target.x, target.y);
  const rc = Math.min(Math.max(r, reach * ANNULUS_IN), reach * ANNULUS_OUT);
  if (r < 1e-9) return { x: rc, y: 0 }; // 退化：方向无定义，给一个确定方向
  return { x: (target.x * rc) / r, y: (target.y * rc) / r };
}

/**
 * 两骨 IK 解析解。目标先做环带钳制，再用余弦定理求肩/肘内角。
 * @param elbowSign 肘弯方向：+1 = 肘折向 y 正方向（屏幕系），-1 相反。
 */
export function solveTwoBone(
  L1: number,
  L2: number,
  target: { x: number; y: number },
  elbowSign: 1 | -1,
): TwoBoneSolution {
  const t = clampToAnnulus(L1, L2, target);
  const d = Math.hypot(t.x, t.y);
  const dir = Math.atan2(t.y, t.x);

  // 余弦定理：肩内角 a1（目标线与大臂夹角）、肘内角 a2（两骨夹角）
  const a1 = Math.acos(clamp11((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const a2 = Math.acos(clamp11((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)));

  const shoulder = dir - elbowSign * a1;
  const elbow = shoulder + elbowSign * (Math.PI - a2);
  return { shoulder, elbow };
}

/** 肘尖（大小臂连接处）的 x 坐标：越大越靠「身后」。 */
function elbowX(L1: number, sol: TwoBoneSolution): number {
  return L1 * Math.cos(sol.shoulder);
}

/**
 * 「肘永远朝身后」选解：在两个肘弯方向里挑肘尖更靠后（+x）的那个；
 * 两解肘尖 x 接近（正对正前/正后等奇异方向附近）时维持 prev，防跳变。
 * @param prev 上一次选定的 elbowSign（首次调用给 1 即可）
 */
export function chooseElbowSign(
  L1: number,
  L2: number,
  target: { x: number; y: number },
  prev: 1 | -1,
): 1 | -1 {
  const a = solveTwoBone(L1, L2, target, 1);
  const b = solveTwoBone(L1, L2, target, -1);
  const dx = elbowX(L1, a) - elbowX(L1, b);
  if (Math.abs(dx) < ELBOW_HYSTERESIS * (L1 + L2)) return prev;
  return dx > 0 ? 1 : -1;
}

function clamp11(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
