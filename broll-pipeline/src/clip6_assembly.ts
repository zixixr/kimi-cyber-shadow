// 工序 06：11 件散开悬浮 → 依次飞拢装配 → 摆臂摆腿活动验证。真实装配树 + ExtrudeGeometry。
import * as THREE from 'three';
import type { ClipCtx } from './main';
import { buildPuppet } from './puppet3d';
import { makeStage } from './three_scene';
import { CLIP_FRAMES, CLEAN, seg, clamp01, lerp, easeInOut, easeOut, setCaption, setStat, type Clip } from './common';

// 拓扑序（父先于子），用于抵消嵌套偏移、按核心→四肢的次序飞拢
const ORDER = ['belly', 'chest', 'head', 'leg_f', 'leg_b', 'upper_arm_f', 'lower_arm_f', 'hand_f', 'upper_arm_b', 'lower_arm_b', 'hand_b'];

export async function create(c: ClipCtx): Promise<Clip> {
  const { gl, assets } = c;
  const stage = makeStage(gl);
  const pup = await buildPuppet(assets);
  stage.scene.add(pup.group);

  const box = pup.box;
  const center = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0);
  const baseHalf = (box.max.y - box.min.y) / 2;

  // 每件装配后关节世界坐标 → 决定爆炸方向
  pup.group.updateWorldMatrix(true, true);
  const info = ORDER.map((name, idx) => {
    const p = pup.parts.get(name)!;
    const w = new THREE.Vector3();
    p.joint.getWorldPosition(w);
    let dir = new THREE.Vector2(w.x - center.x, w.y - center.y);
    if (dir.length() < 1e-3) dir = new THREE.Vector2(0, -1);
    const jitter = Math.sin(idx * 12.9898) * 0.6; // 确定性角度扰动
    const ang = Math.atan2(dir.y, dir.x) + jitter * 0.5;
    const mag = 0.16 + (idx % 3) * 0.03;
    const off = new THREE.Vector3(Math.cos(ang) * mag, Math.sin(ang) * mag, (p.def.layer % 5) * 0.012);
    const spin = (idx % 2 ? 1 : -1) * (0.4 + jitter * 0.3);
    const start = 60 + idx * 15;
    return { name, p, off, spin, start };
  });

  const frames = CLIP_FRAMES[6];

  function limbRamp(frame: number) {
    return easeInOut(clamp01(seg(frame, 322, 372)));
  }

  return {
    frames,
    seek(frame: number) {
      const worldOff = new Map<string, THREE.Vector3>();
      let assembled = 0;

      for (const it of info) {
        const aT = easeOut(clamp01(seg(frame, it.start, it.start + 58)));
        if (aT >= 0.995) assembled++;
        const bob = frame < it.start + 58 ? Math.sin(frame * 0.06 + it.p.def.layer) * 0.006 * (1 - aT) : 0;
        const off = it.off.clone().multiplyScalar(1 - aT);
        off.y += bob;
        worldOff.set(it.name, off);
        // 关节局部位置 = 基准 + (本件世界偏移 − 父件世界偏移)，抵消嵌套累加
        const parent = it.p.def.parent;
        const pOff = parent ? worldOff.get(parent)! : new THREE.Vector3();
        it.p.joint.position.set(
          it.p.baseJointPos.x + off.x - pOff.x,
          it.p.baseJointPos.y + off.y - pOff.y,
          it.p.baseJointPos.z + off.z - pOff.z,
        );
        // 绕铆点自旋，飞拢时归零
        it.p.mesh.rotation.z = it.spin * (1 - aT);
      }

      // 活动验证：小幅摆臂 / 轻抬腿 / 点头。皮件绕肩铆点作单摆——纯绕关节旋转（无平移），
      // 幅度小、正弦本身即缓入缓出，读作「检查铰接是否顺」而非甩臂。
      const r = limbRamp(frame);
      const ph = frame * 0.05; // 慢摆（≈2s/次）
      const setRot = (name: string, v: number) => {
        const p = pup.parts.get(name)!;
        p.joint.rotation.z = (p.def.rest ?? 0) + v;
      };
      // 肩摆：前后臂反相，绕肩关节小幅前后摆（AMP≈6.9°）。肘部保持一点恒定回折（自然松弛，
      // 不打直），叠一点相位滞后的跟随（follow-through）——幅度都小，故不再有前臂大幅独立折起
      // 的扭曲/甩动。前臂折向身后（负），后臂 flipX 折向身后（正），符合关节结构。
      const swing = Math.sin(ph); // -1..1 肩驱动
      const AMP = 0.12; // 肩摆幅度（rad，~6.9°）
      const EL_BASE = 0.13; // 肘恒定回折量（rad）
      const EL_AMP = 0.05; // 肘跟随幅度（rad）
      const elbowFollow = EL_BASE + EL_AMP * Math.sin(ph - 0.5); // 恒折 + 小幅滞后跟随
      setRot('upper_arm_f', r * AMP * swing);
      setRot('lower_arm_f', r * -elbowFollow); // 前臂：折向身后（负）
      setRot('upper_arm_b', r * -AMP * swing);
      setRot('lower_arm_b', r * elbowFollow); // 后臂 flipX：折向身后（正）
      setRot('leg_f', r * 0.16 * Math.sin(ph * 0.9)); // 轻抬腿
      setRot('leg_b', r * 0.16 * Math.sin(ph * 0.9 + Math.PI));
      setRot('head', r * 0.06 * Math.sin(ph * 0.5)); // 微点头
      setRot('chest', r * 0.04 * Math.sin(ph * 0.5));

      // 相机：爆炸时略拉远，飞拢时推近
      const g = easeInOut(clamp01(seg(frame, 60, 300)));
      const zoom = CLEAN ? 0.86 : 1; // clean 下拉近放大占满
      const halfH = lerp(baseHalf * 1.62, baseHalf * 1.24, g) * zoom;
      stage.frame(center.x, center.y + baseHalf * 0.04, halfH);
      stage.render();

      let cap: string, stat: string;
      if (frame < 58) {
        cap = '挤出厚片 · 铆孔待接';
        stat = `<div><span class="big">11</span><span class="unit"> 件</span></div><div class="unit">待装配</div>`;
      } else if (frame < 305) {
        cap = '铆点铰接 · 单轴铰链';
        stat = `<div><span class="big">${assembled}</span><span class="unit"> / 11</span></div><div class="unit">已装配</div>`;
      } else if (frame < 372) {
        cap = '装配完成 · 铰链铰接';
        stat = `<div><span class="big">11</span><span class="unit"> / 11</span></div><div class="unit">装配完成</div>`;
      } else {
        cap = '摆臂 · 抬腿 · 活动验证';
        stat = `<div><span class="big">OK</span></div><div class="unit">铰链活动正常</div>`;
      }
      setCaption(`${cap}`);
      setStat(stat);
    },
  };
}
