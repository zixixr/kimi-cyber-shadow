// 确定性逐帧捕获 harness（?capture=1）：为程序化 B-roll 录制服务。
//   - 隐藏一切 UI（对照表 / 摄像头 PIP / 开场报幕 / 鼠标指针 / 提示条），画面只留戏台；
//   - 不用真实墙钟：暴露 window.__cap = { ready, step() }，每次 step() 以固定 dt=1/60
//     推进一帧逻辑并渲染一次（CaptureClock 冒充 THREE.Clock 的 getDelta/elapsedTime）；
//   - 脚本化信号源 ScriptedSource（与鼠标调试源同接口 HandSource），按关键帧时间线
//     输出手势/位置/进深信号，用 ?script=<name> 选择；不请求摄像头；
//   - 多机位：?cam=front（观众正面）/ ?cam=back（复用幕后侧后 45° 机位）。同一 script
//     时间线在不同 cam 下动作逐帧一致（相机不同、影人逻辑同一份）。
//
// 用法（录制脚本 capture/record.py 驱动）：
//   window.__cap.ready===true 后，反复 __cap.step() + 截图，即得逐帧确定性序列。

import type { PerspectiveCamera } from 'three';
import { SCREEN_CY } from './stage/theater';
import { emptySignal, type HandSignal, type HandSource, type NormPoint } from './hand/source';

const P = new URLSearchParams(location.search);
/** 捕获模式总开关 */
export const CAPTURE = P.get('capture') === '1';
/** 脚本名（见 SCRIPTS） */
export const CAP_SCRIPT = P.get('script') ?? 'ik_simple';
/**
 * 机位：front=观众正面（主相机）/ back=幕后侧后 45°（复用 backstage）/
 * orbit=正面→侧后连续环绕（相机路径 f(t)，见 captureOrbitCamera；不复用 backstage，纯净无标注）/
 * rods=操纵杆特写（幕后侧视缓推，见 captureRodsCamera；显操纵杆、隐一切标注）/
 * props=置景扫过（幕后 3/4 侧视横移缓推，见 capturePropsCamera；扫过酒旗/山石厚片，纯净无标注）/
 * hook=片头「幕后 3D 奇观」低机位侧后缓推（见 captureHookCamera；显双角色签杆、隐标注，
 *      同框收灯/光锥/幕布透光背面 + 红孩儿三昧真火逆光火舌，配 ?scene=xiyou&script=xiyou_hook）
 */
export const CAP_CAM: 'front' | 'back' | 'orbit' | 'rods' | 'props' | 'hook' =
  P.get('cam') === 'back'
    ? 'back'
    : P.get('cam') === 'orbit'
      ? 'orbit'
      : P.get('cam') === 'rods'
        ? 'rods'
        : P.get('cam') === 'props'
          ? 'props'
          : P.get('cam') === 'hook'
            ? 'hook'
            : 'front';
/** 固定步长：60fps */
export const CAP_DT = 1 / 60;

/**
 * 确定性时钟：冒充 THREE.Clock 的 getDelta()/elapsedTime，供 main 主循环无改动读取。
 * advance(dt) 在每次 step() 里手动推进——绝不依赖墙钟（requestAnimationFrame / performance.now）。
 */
export class CaptureClock {
  elapsedTime = 0;
  private dt = 0;
  advance(dt: number): void {
    this.dt = dt;
    this.elapsedTime += dt;
  }
  getDelta(): number {
    return this.dt;
  }
  getElapsedTime(): number {
    return this.elapsedTime;
  }
}

/** 全局唯一确定性时钟（main 主循环与 ScriptedSource 共享同一时间轴） */
export const capClock = new CaptureClock();

let loopFn: (() => void) | null = null;
/** main 把主循环体注册进来（捕获模式下不再走 renderer.setAnimationLoop） */
export function registerLoop(fn: () => void): void {
  loopFn = fn;
}

/** 安装 window.__cap 控制器：step() 推进一帧确定性时钟 + 跑一次主循环体 */
export function installCapController(): { ready: boolean; frame: number; step(): void } {
  const cap = {
    ready: false,
    frame: 0,
    step(): void {
      capClock.advance(CAP_DT);
      loopFn?.();
      this.frame++;
    },
  };
  (window as unknown as { __cap: typeof cap }).__cap = cap;
  return cap;
}

// ---------------- ?cam=orbit：绕轴连续环绕相机路径 f(t) ----------------
//
// 一条 6.0s 的确定性相机运动，纯净叠加层用（不上 backstage 的操纵杆 / 中文标注 / 操作条）：
//   0.0–1.0s 正面停留（观众视角，看幕布上皮影角色在动）
//   1.0–4.5s 水平环绕 3.5s（绕台心从正面经右侧到侧后 45°，smootherstep 缓入缓出）
//   4.5–6.0s 幕后定住 1.5s（看点光源 / 有厚度的影人侧面 / 光锥 / 幕布背面）
// 起止两端用与 backstage 一致的球坐标参数（target=幕心略偏幕后 z=0.2），
// 首末各自 smootherstep 导数为 0 → 停留段完全静止、环绕段无跳切。
//
// 球坐标：theta 自 +z 轴向 +x 旋转（0=幕正后方，PI=观众正面）、phi 自 +y 轴、r=到 target 距离。
const ORBIT_TARGET_Z = 0.2; // 环绕台心 z（与 backstage ORBIT_TARGET 一致；x=0、y=SCREEN_CY）
const ORBIT_FRONT = { theta: Math.PI, phi: Math.PI / 2, r: 2.5, lookZ: 0 }; // 正面观众机位（= (0,SCREEN_CY,-2.3) 看幕心）
const ORBIT_BACK = { theta: Math.PI / 4, phi: 1.3, r: 2.6, lookZ: 0.2 }; // 侧后 45°（= backstage 默认幕后机位）
const ORBIT_HOLD_FRONT_S = 1.0; // 正面停留
const ORBIT_MOVE_S = 3.5; // 环绕时长（其后到 6.0s 为幕后停留）

/** smootherstep（6x^5−15x^4+10x^3）：首末一二阶导皆 0，缓入缓出比 smoothstep 更顺 */
const smootherstep = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

/**
 * ?cam=orbit 每帧相机定位：按确定性时间 t（秒）沿环绕路径写 camera.position + lookAt。
 * 在 capture 主循环里调用（backstage 保持 front 态不介入，故无操纵杆 / 标注）。
 */
export function captureOrbitCamera(t: number, camera: PerspectiveCamera): void {
  const p = smootherstep((t - ORBIT_HOLD_FRONT_S) / ORBIT_MOVE_S);
  const theta = lerp(ORBIT_FRONT.theta, ORBIT_BACK.theta, p);
  const phi = lerp(ORBIT_FRONT.phi, ORBIT_BACK.phi, p);
  const r = lerp(ORBIT_FRONT.r, ORBIT_BACK.r, p);
  const sp = Math.sin(phi);
  camera.position.set(r * sp * Math.sin(theta), SCREEN_CY + r * Math.cos(phi), ORBIT_TARGET_Z + r * sp * Math.cos(theta));
  camera.lookAt(0, SCREEN_CY, lerp(ORBIT_FRONT.lookZ, ORBIT_BACK.lookZ, p));
}

// ---------------- ?cam=rods：操纵杆特写（幕后侧视缓推） ----------------
//
// 4.0s 确定性相机运动，纯净叠加层用（显操纵杆本体、隐一切中文标注 / 操作条 / 引线）：
// 影人站定原位做缓慢亮相摆臂（script=reveal），三根签杆（颈后主杆 + 双手手签）随手牵动。
// 机位落在幕后偏侧上方、贴近影人（r 小 → 特写），全程缓慢横向小环绕 + 缓推，让签杆
// 从关节向幕后延伸的走向读得清楚，且随手臂摆动而摆。target 取影人胸颈之间（略偏幕后 z）。
const RODS_TARGET = { x: 0.0, y: 1.02, z: 0.24 };
const RODS_THETA_A = 1.24; // 起手：更偏侧（看签杆侧走向）
const RODS_THETA_B = 0.86; // 收势：转向偏幕后
const RODS_PHI = 1.32; // 略高于台面平视（俯看签杆与手的连接）
const RODS_R_A = 0.98; // 起手距离（特写）
const RODS_R_B = 0.8; // 收势距离（再缓推近一点）

/**
 * ?cam=rods 每帧相机定位：4.0s 内沿一条缓慢侧向小环绕 + 缓推的路径运动。
 * smootherstep 全程铺满 → 首末速度为 0（无跳切），中段匀顺横移。签杆由 backstage
 * 的 enterCaptureRodsClean 每帧刷新（无标注），本函数只管机位。
 */
export function captureRodsCamera(t: number, camera: PerspectiveCamera): void {
  const p = smootherstep(t / 4.0);
  const theta = lerp(RODS_THETA_A, RODS_THETA_B, p);
  const r = lerp(RODS_R_A, RODS_R_B, p);
  const sp = Math.sin(RODS_PHI);
  camera.position.set(
    RODS_TARGET.x + r * sp * Math.sin(theta),
    RODS_TARGET.y + r * Math.cos(RODS_PHI),
    RODS_TARGET.z + r * sp * Math.cos(theta),
  );
  camera.lookAt(RODS_TARGET.x, RODS_TARGET.y, RODS_TARGET.z);
}

// ---------------- ?cam=props：置景扫过（幕后 3/4 侧视横移缓推） ----------------
//
// 6.0s 确定性相机运动，纯净叠加层用（无操纵杆 / 无标注）：
// 幕后 3/4 斜侧机位（既见皮件正脸、又见侧面 2mm 厚边）自右向左横移扫过布景——
// 起手偏右含灯与幕布交代空间，随后 target 缓缓 truck 到酒旗 / 山石一侧并缓推近，
// 让「一片片有厚度的薄片立在戏台上」的厚边读得清楚。首末停留、smootherstep 缓入缓出。
const PROPS_HOLD_S = 0.7; // 起手停留
const PROPS_MOVE_S = 4.6; // 横移 + 缓推时长（其后到 6.0s 为落幅停留）
const PROPS_TX_A = 0.15; // 起手 target x（偏右：灯 / 幕 / 影人一侧）
const PROPS_TX_B = -0.32; // 落幅 target x（酒旗 x=-0.25 / 山石 x=-0.3 一侧）
const PROPS_TY = 0.82; // target 高（酒旗悬高、山石落地之间）
const PROPS_TZ = 0.1; // target z（贴幕布景一侧）
// 机位自幕后偏右（含灯 / 幕 / 影人）经正后方（认得出布景正脸）扫到布景外侧（-x 侧）掠视，
// 让薄片近乎侧向 → 2mm 侧棱 / 立起的厚片读得出；同时影人在右侧越推越远、缩小退出，不抢戏。
const PROPS_THETA_A = 0.6; // 起手方位（幕后偏右，含灯 / 幕 / 空间 / 影人）
const PROPS_THETA_B = -0.72; // 落幅方位（掠到布景外侧 -x，看薄片厚边；影人已远小）
const PROPS_PHI = 1.44; // 俯仰（接近平视，掠着看薄片侧棱）
const PROPS_R_A = 1.5; // 起手距离（较远，含灯 / 幕）
const PROPS_R_B = 1.02; // 落幅距离（缓推近看厚边）

/**
 * ?cam=props 每帧相机定位：6.0s 内起手停留 → 横移 + 缓推扫过布景 → 落幅停留。
 * target 自右向左 truck、机位 theta 转向偏幕后、r 缓推近；smootherstep 铺满移动段 →
 * 首末导数为 0，停留段完全静止、扫移段无跳切。backstage 保持 front 态不介入（纯净）。
 */
export function capturePropsCamera(t: number, camera: PerspectiveCamera): void {
  const p = smootherstep((t - PROPS_HOLD_S) / PROPS_MOVE_S);
  const tx = lerp(PROPS_TX_A, PROPS_TX_B, p);
  const theta = lerp(PROPS_THETA_A, PROPS_THETA_B, p);
  const r = lerp(PROPS_R_A, PROPS_R_B, p);
  const sp = Math.sin(PROPS_PHI);
  camera.position.set(
    tx + r * sp * Math.sin(theta),
    PROPS_TY + r * Math.cos(PROPS_PHI),
    PROPS_TZ + r * sp * Math.cos(theta),
  );
  camera.lookAt(tx, PROPS_TY, PROPS_TZ);
}

// ---------------- ?cam=hook：片头「幕后 3D 奇观」低机位侧后缓推 ----------------
//
// 8.0s 确定性相机（配 ?scene=xiyou&script=xiyou_hook）：幕后侧后 ~40°，比 backstage（phi=1.3、
// 机位高于台面）更低——近台面高度、略仰看角色，让红孩儿三昧真火逆着幕布背光、双影人 3D 厚度顶光
// 立体感最强；且比 backstage 默认 2.6m 更近（缓推 2.15→1.85m）。同框收进：点光源 + 体积光锥 +
// 幕布透光背面 + 双角色（各三根签杆）+ 逆光火舌。target 取两人之间略偏红孩儿（火源）一侧、胸颈高度、
// 贴幕布景一侧 z。smootherstep 铺满全段 → 首末导数 0（无跳切、缓推匀顺），叠极小 theta 漂移给厚度视差。
// backstage 已 enterCaptureRodsClean 显双角色签杆、隐一切标注；相机由本函数逐帧驱动（本类不碰相机）。
const HOOK_TARGET = { x: 0.06, y: 1.06, z: 0.16 };
const HOOK_PHI = 1.62; // 俯仰：近台面平视略仰（cos<0 → 机位略低于 target，仰看角色 + 逆光火舌）
const HOOK_THETA_A = 0.66; // 起手方位（幕后侧后）
const HOOK_THETA_B = 0.82; // 落幅方位（略转向侧，露皮件 3D 厚度视差）
const HOOK_R_A = 2.15; // 起手距离
const HOOK_R_B = 1.85; // 落幅距离（缓推近一点）

/**
 * ?cam=hook 每帧相机定位：8.0s 内沿一条低机位、侧后、缓推的路径运动（首末速度 0，无跳切）。
 */
export function captureHookCamera(t: number, camera: PerspectiveCamera): void {
  const p = smootherstep(t / 8.0);
  const theta = lerp(HOOK_THETA_A, HOOK_THETA_B, p);
  const r = lerp(HOOK_R_A, HOOK_R_B, p);
  const sp = Math.sin(HOOK_PHI);
  camera.position.set(
    HOOK_TARGET.x + r * sp * Math.sin(theta),
    HOOK_TARGET.y + r * Math.cos(HOOK_PHI),
    HOOK_TARGET.z + r * sp * Math.cos(theta),
  );
  camera.lookAt(HOOK_TARGET.x, HOOK_TARGET.y, HOOK_TARGET.z);
}

// ---------------- 脚本化信号源 ----------------

const smoothstep = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** 高斯凸包（短促抽动用）：中心 c、宽 w，峰值 1 */
const gaussBump = (t: number, c: number, w: number): number => Math.exp(-(((t - c) / w) ** 2));

/**
 * 起跳腕冲：中心 c 前 0.18s 内快速上抬 0.5（腕纵向速度尖峰 → 触发导演 jump → 筋斗云生脚下），
 * 其后 0.5s 缓落归零。窗口外恒 0。两次调用叠加即两跳（间隔须 > JUMP_LOCK 0.9s）。
 */
const jumpBump = (t: number, c: number): number => {
  if (t < c - 0.18 || t > c + 0.5) return 0;
  return t < c ? 0.5 * ((t - (c - 0.18)) / 0.18) : 0.5 * (1 - (t - c) / 0.5);
};

/** 站定基准信号：站定（wrist.x=0）、直立（wrist.y 略负，不触发跳/蹲）、中位进深、自然手 */
function base(): HandSignal {
  const s = emptySignal();
  s.present = true;
  s.handedness = 'right';
  s.wrist = { x: 0, y: -0.05 };
  s.palm = { x: 0, y: -0.05 };
  s.depth = 0.15;
  s.lean = 0;
  s.gesture = 'none';
  s.indexTip = { x: -0.8, y: 0.1 };
  return s;
}

/** 一条脚本 = 时间（秒）→ 归一化手信号（单手；多角色脚本返回手数组，第 1 手=主角、第 2 手=第二角色） */
type ScriptFn = (t: number) => HandSignal | HandSignal[];

const SCRIPTS: Record<string, ScriptFn> = {
  // 05 段 IK 对比 · 僵硬版：武生站定，两根签杆(食指+拇指)分别控制两只手 → 双臂各走 IK。
  //   信号只负责让影人「站定不动」（gesture=none）；两条手臂的 IK 目标由 ARM_OVERRIDES
  //   在 capture 循环里直驱（绕过 director——本就是「简陋 IK 版」演示）。见 ik_simple 覆盖项。
  ik_simple(): HandSignal {
    return base(); // 站定：手势 none、腕居中 → 导演出 idle 站姿，双臂交给 override
  },

  // 05 段 IK 对比 · 状态机版：同机位同布景，依次触发「一个手势=整套表演」。
  //   握拳（拳脚连招循环）→ 剑指（器械套路）→ 手掌移动（走位）→ 快速上提（跳）→ 亮相收势。
  sm_rich(t: number): HandSignal {
    const s = base();
    if (t < 3) {
      s.gesture = 'fist'; // 拳脚连招：直拳→抡拳→踢腿→弓步循环
    } else if (t < 6) {
      s.gesture = 'sword'; // 器械套路：高劈→侧扫→前刺→环绕
    } else if (t < 8.6) {
      // 手掌移动 = 走位（净位移驱动走/跑 + 自动面向行进方向）
      s.gesture = 'none';
      const tt = t - 6;
      s.wrist.x = 0.5 * Math.sin(tt * 1.5);
      s.palm.x = s.wrist.x;
    } else if (t < 9.5) {
      // 收步站定 → 快速上提触发跳（腕纵向速度尖峰）
      s.gesture = 'none';
      if (t >= 8.9 && t < 9.4) {
        const k = (t - 8.9) / 0.5; // 0..1
        const tri = k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6; // 快上（0.2s）后落
        s.wrist.y = -0.05 + 0.6 * tri;
      }
    } else {
      s.gesture = 'open'; // 亮相：对观众持续挥手收势
    }
    return s;
  },

  // 06 段幕后光学：影人贴幕（影小而锐）→ 缓慢移向灯（影大、边缘变虚）→ 回到中位。
  //   同一时间线正面机位看幕布影子、幕后机位看真实走位与灯（帧级同步）。
  optics(t: number): HandSignal {
    const s = base();
    // 缓慢行走剪影：皮影最经典的动态，无器械套路的翻身/劈扫节拍（那些节拍里头件会瞬时转成
    // 侧棱不可见，慢镜头 B-roll 会露馅）；「边走边靠近灯」与影子虚实变化叙事贴合。
    s.gesture = 'none';
    const drift = -0.02 - 0.16 * smoothstep(t / 15); // 单向缓慢位移（不回头，避免转身翻身）
    s.wrist.x = drift;
    s.palm.x = drift;
    let depth: number;
    if (t < 3) {
      depth = 0.06; // 贴幕：影小而锐（留 0.06 余量防头件层序穿过幕布平面被剔除）
    } else if (t < 9) {
      depth = 0.06 + 0.89 * smoothstep((t - 3) / 6); // 缓慢移向灯：影大、边缘变虚
    } else {
      depth = 0.95 - 0.8 * smoothstep((t - 9) / 6); // 回中位（0.15）
    }
    s.depth = depth;
    return s;
  },

  // 操纵杆特写（?cam=rods）：影人站定原位（rootX=0、近幕 depth=0.15），双臂交给 reveal 覆盖项
  //   做缓慢亮相摆臂 → 颈后主杆 + 双手手签三根签杆随手牵动。手势置 none（导演出 idle 站姿，
  //   双臂全交 ARM_OVERRIDES.reveal 直驱）。
  reveal(): HandSignal {
    const s = base();
    s.depth = 0.15;
    return s;
  },

  // 置景扫过（?cam=props）：影人靠右站定（rootX≈0.45，让开左侧布景区），亮相摆臂添动态；
  //   相机横移到酒旗 / 山石一侧时影人自然出画。手势 open = 导演动画亮相挥手（无需覆盖项）。
  props_scene(): HandSignal {
    const s = base();
    s.gesture = 'open';
    s.wrist.x = -0.714; // rootX = -wrist.x×0.7 ≈ 0.5（靠右，恒定不触发走位）
    s.palm.x = s.wrist.x;
    s.depth = 0.2;
    return s;
  },

  // 片头 hook「幕后 3D 奇观」（?scene=xiyou&cam=hook）：两只脚本手同时在镜（导演路由：第 1 手=悟空、
  //   第 2 手=红孩儿）。悟空先走位入场（净 +x 位移 → 自动面向翻到 -1、转身正对红孩儿），随后金箍棒
  //   器械套路大幅挥棒 + 两次筋斗云起跳；红孩儿张开手 = 三昧真火整段持续喷。两人拉开 ≈0.85m
  //   （> 火舌远界 0.78 → 火够不到悟空不触发受击；棒也够不到红孩儿不触发败阵）→ 火整段不熄、
  //   双方动作幅度大且稳定可复现。相机由 captureHookCamera 驱动、签杆由 enterCaptureRodsClean 显示。
  xiyou_hook(t: number): HandSignal[] {
    // --- 悟空（主角，signals[0]）---
    const hero = base();
    hero.handedness = 'right';
    hero.depth = 0.12; // 贴幕近一点：3D 厚度 + 幕布透光背面同框
    // 入场走位：rootX 由 -0.62 缓推到 -0.40（净 +x 位移 → 导演自动面向翻到 -1，转身对着红孩儿）
    const enter = smootherstep(Math.min(1, t / 0.9));
    hero.wrist.x = lerp(0.886, 0.571, enter); // rootX = -wrist.x×0.7：-0.62 → -0.40
    hero.palm.x = hero.wrist.x;
    hero.gesture = t < 0.95 ? 'none' : 'sword'; // 走位入场后转金箍棒器械套路（四拍大幅挥棒）
    // 两次筋斗云：wrist.y 短促上冲（腕纵向速度尖峰触发跳跃 → 云生脚下），间隔 2.9s > JUMP_LOCK
    hero.wrist.y = -0.05 + jumpBump(t, 2.3) + jumpBump(t, 5.2);

    // --- 红孩儿（第二角色，signals[1]）：张开手持续喷三昧真火 ---
    const foe = base();
    foe.handedness = 'left';
    foe.gesture = 'open'; // 第二只手张开 = 三昧真火（xiyou 整段喷；覆盖层出仰头喷火姿势）
    foe.wrist.x = -0.643; // rootX = +0.45（红孩儿在观众右、默认面向 -x 正对悟空，火向左喷入画）
    foe.palm.x = foe.wrist.x;
    foe.depth = 0.12;
    return [hero, foe];
  },
};

// ---------------- 双臂 IK 直驱覆盖（capture 专用，绕过 director） ----------------
//
// 演示的失败模式：「食指 + 拇指模拟两根签杆，分别控制角色两只手」——但手指活动范围
// 有限 → 两条手臂能动的角度也很有限。所以两个 IK 目标点都被压在一小块活动区里：
// 手臂只能小幅、别扭地摆，明显「伸展不开」；禁大幅挥舞、禁整臂转圈。
//
// 目标点在影人局部系（肩为原点，y 向上，+x=身后；Puppet.pointAt 语义）。
// armReach≈0.172，IK 环带钳制 [0.060,0.167]；基准半径取 ~0.11（落环带中段、肘明显弯）。
// 侧面像两臂在躯干处高度重叠，若都竖着垂下会糊成「一条臂」，故基准姿态左右岔开成浅 V。
// 前 6s 全程压在肩线下、小幅慢摆；后 6s 前臂小幅乱颤＋慢包络折起（radius 偶尔触内缘→折臂、别扭，
// 但始终不越肩线故不翻肘），后臂在乱颤之外另叠两次短促「抬到肩高」的抽动——目标越过肩线水平方向时
// 两骨解翻面 → 偶发肘部翻转（这是本 rig 里唯一能产生肘翻的几何：dx∝sin(dir)，过水平线才变号）。

/** 一侧手臂的 IK 目标 */
export interface ArmTargets {
  front: NormPoint;
  back: NormPoint;
}

/** capture 模式下直驱两臂 IK 的脚本（键同 ?script=）；返回 null 表示该脚本走常规 director */
const ARM_OVERRIDES: Record<string, (t: number) => ArmTargets> = {
  ik_simple(t: number): ArmTargets {
    // 侧面像两臂在躯干处高度重叠，若都竖着垂下会糊成「一条臂」。为让两条手臂都看得见且
    // 各自都在动，把基准姿态左右岔开成浅 V：前臂朝身前（-x=画面左）下探、后臂朝身后
    // （+x=画面右）下探，各自只做小幅摆动/抖动——岔开是「静态偏置」，动的幅度依旧很小。
    const fBase = { x: -0.075, y: -0.095 }; // r≈0.12（落环带中段，肘明显弯）
    const bBase = { x: 0.075, y: -0.09 }; // r≈0.117
    if (t < 6) {
      // 前 6s：缓慢小幅晃动——两臂不同频不同相，幅度就那么点（±≤0.028），明显伸展不开
      return {
        front: {
          x: fBase.x + 0.028 * Math.sin(t * 0.8),
          y: fBase.y + 0.024 * Math.sin(t * 0.6 + 0.6),
        },
        back: {
          x: bBase.x + 0.026 * Math.sin(t * 0.65 + 1.4),
          y: bBase.y + 0.026 * Math.sin(t * 0.95 + 2.1),
        },
      };
    }
    const tt = t - 6;
    // 前臂：小幅高频乱颤（±≤0.02）＋慢包络把手往肩根拽（折起、别扭）。始终压在肩线下方
    //   → 两骨解不翻面，是「纯抖 + 折起」的僵硬感。pull 从 ~0.98 起（t=6 不突然缩臂）。
    const pullF = 0.8 + 0.18 * Math.cos(tt * 0.7); // 0.62..0.98，tt=0 时≈0.98
    const fjx = 0.019 * Math.sin(tt * 13.0) + 0.011 * Math.sin(tt * 21.0 + 0.5);
    const fjy = 0.015 * Math.sin(tt * 15.5 + 0.3) + 0.009 * Math.sin(tt * 24.0 + 1.1);
    // 后臂：同样小幅乱颤，另叠两次短促「抬到肩高」的抽动（gauss 凸包）——目标越过肩线水平方向，
    //   两骨 IK 解翻面 → 偶发肘部翻转（别扭地一弹又弹回）。其余时间仍压在肩线下、活动范围很小。
    const twitch = 0.115 * (gaussBump(tt, 1.4, 0.5) + gaussBump(tt, 4.3, 0.5));
    const bjx = 0.016 * Math.sin(tt * 17.0 + 1.0) + 0.01 * Math.sin(tt * 27.0 + 0.7);
    const bjy = 0.014 * Math.sin(tt * 19.0 + 1.2) + 0.008 * Math.sin(tt * 30.0 + 0.2);
    return {
      front: { x: fBase.x * pullF + fjx, y: fBase.y * pullF + fjy },
      back: { x: 0.062 + 0.02 * Math.sin(tt * 0.7) + bjx, y: -0.085 + twitch + bjy },
    };
  },

  // 操纵杆特写（?cam=rods）用：缓慢、大幅的双臂亮相摆臂——与 ik_simple 的「憋屈小幅」相反，
  //   这里两臂都伸到环带外缘（r≈0.15，肘展开）、在一段慢弧里升起铺开又轻摆，让双手手签清楚
  //   地随手牵动、摆幅可读。目标点始终落在 IK 环带 [0.060,0.167] 内（|target|=r）。
  //   local 系：-x=身前（画面前）、+x=身后；y 向上。前手朝身前上抬、后手朝身后上抬（浅 V 亮相）。
  reveal(t: number): ArmTargets {
    const r = 0.15; // 落环带外缘：两臂伸展、签杆摆幅大而清楚
    const raise = smootherstep(Math.min(1, Math.max(0, (t - 0.3) / 2.2))); // 0→1 缓慢升起（~0.3–2.5s）
    const af = lerp(-0.85, 0.5, raise) + 0.2 * Math.sin(t * 1.25); // 前手角：下前 → 上前 + 慢摆
    const ab = lerp(-0.65, 0.68, raise) + 0.17 * Math.sin(t * 1.05 + 1.0); // 后手角：下后 → 上后 + 慢摆
    return {
      front: { x: -r * Math.cos(af), y: r * Math.sin(af) }, // 身前（-x），随 af 升起
      back: { x: r * Math.cos(ab), y: r * Math.sin(ab) }, // 身后（+x），随 ab 升起
    };
  },
};

/** 当前 ?script= 若为双臂直驱脚本，返回该帧两臂 IK 目标；否则 null（走常规 director） */
export function captureArmOverride(t: number): ArmTargets | null {
  return ARM_OVERRIDES[CAP_SCRIPT]?.(t) ?? null;
}

/**
 * 脚本化信号源：实现与鼠标调试源相同的 HandSource 接口，但信号来自脚本时间线。
 * 读时以共享 capClock 的确定性时间求值——不请求摄像头、不依赖墙钟。
 */
export class ScriptedSource implements HandSource {
  readonly name = '脚本';
  private script: ScriptFn;

  constructor(name: string) {
    this.script = SCRIPTS[name] ?? SCRIPTS.ik_simple;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  read(): HandSignal[] {
    const r = this.script(capClock.elapsedTime);
    return Array.isArray(r) ? r : [r];
  }

  dispose(): void {}
}
