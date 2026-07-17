// 拖点标定参数中心（文档第 8 章「标定工具哲学」）：
// 把「只有人眼能定」的数值收敛成一个可读写的单例 ——
//   main 每帧读（数值实时生效，含正常运行时），Tuner 拖动时写（即时反馈），
//   每次改动即存 localStorage（刷新不丢）；用户把面板数值报给开发者后，
//   固化为代码默认值（mouth/grip 的默认值直接引用 xiyou.MOUTH_OFF / goldenstaff.GRIP_DIST，
//   保持「代码常量 = 已固化标定值」单一事实源）。
// r 键 / 面板「重置」→ resetCalib 恢复默认（原地改写单例，已有引用不失效）。

import { MOUTH_OFF } from '../game/xiyou';
import { GRIP_DIST } from '../stage/goldenstaff';

/** 可标定数值集（全部世界系米 / 无量纲缩放比） */
export interface CalibValues {
  /** 🔥 嘴部火源相对头关节（颈部铆点）的偏移：x=面向前移（米），y=上移（米） */
  mouth: { x: number; y: number };
  /** ✊ 后手握棒点：沿棒线距前手的投影距离（米，负 = 前手上方回退） */
  grip: number;
  /** 👤 头关节相对装配基准的偏移（米，父件局部系）：调脖颈插领深度 */
  headOff: { x: number; y: number };
  /** 💪 臂长缩放（关节树整体缩放，同步 IK 段长） */
  armScale: number;
  /** 🦵 腿长缩放（关节树整体缩放，root 自动上移补偿保持贴地） */
  legScale: number;
}

const KEY = 'cyber-shadow.calib.v1';

/** 代码固化默认值（= 当前各模块常量的现值；头/臂/腿默认为「装配原样」） */
export function defaultCalib(): CalibValues {
  return {
    mouth: { x: MOUTH_OFF.x, y: MOUTH_OFF.y },
    grip: GRIP_DIST,
    headOff: { x: 0, y: 0 },
    armScale: 1,
    legScale: 1,
  };
}

let _calib: CalibValues | null = null;

/** localStorage 不可用（单测 node 环境 / 隐私模式）时静默退化为内存单例 */
function storageGet(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function storageSet(s: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, s);
  } catch {
    /* 写入失败不影响当次生效 */
  }
}

/** 单例：main 与 Tuner 共享同一对象，拖动即时生效 */
export function loadCalib(): CalibValues {
  if (_calib) return _calib;
  const d = defaultCalib();
  const s = storageGet();
  if (s) {
    try {
      const j = JSON.parse(s) as Partial<CalibValues>;
      _calib = {
        ...d,
        ...j,
        mouth: { ...d.mouth, ...j.mouth },
        headOff: { ...d.headOff, ...j.headOff },
      };
      return _calib;
    } catch {
      /* JSON 损坏按默认处理 */
    }
  }
  _calib = d;
  return _calib;
}

/** 持久化（拖动松手 / 重置时调用） */
export function saveCalib(v: CalibValues): void {
  storageSet(JSON.stringify(v));
}

/** 恢复默认：原地改写单例（main/Tuner 持有的引用继续有效）并持久化 */
export function resetCalib(): CalibValues {
  const c = loadCalib();
  const d = defaultCalib();
  c.mouth = d.mouth;
  c.grip = d.grip;
  c.headOff = d.headOff;
  c.armScale = d.armScale;
  c.legScale = d.legScale;
  saveCalib(c);
  return c;
}
