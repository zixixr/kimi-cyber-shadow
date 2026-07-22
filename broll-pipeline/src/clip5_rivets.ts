// 工序 05：装配姿态下铆点依次 ping 亮，连线成铰链层级树（真实 pivots 世界坐标）。
import * as THREE from 'three';
import type { ClipCtx } from './main';
import { buildPuppet } from './puppet3d';
import { makeStage } from './three_scene';
import { CLIP_FRAMES, CLEAN, seg, clamp01, lerp, setCaption, setStat, type Clip } from './common';

// 铰链树 BFS 顺序（belly 为根，其余 10 件各含一个铆点）
const ORDER = ['belly', 'chest', 'leg_f', 'leg_b', 'head', 'upper_arm_f', 'upper_arm_b', 'lower_arm_f', 'lower_arm_b', 'hand_f', 'hand_b'];

export async function create(c: ClipCtx): Promise<Clip> {
  const { gl, ctx, W, H, assets } = c;
  const stage = makeStage(gl);
  const pup = await buildPuppet(assets);
  stage.scene.add(pup.group);

  const box = pup.box;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const halfH = ((box.max.y - box.min.y) / 2) * (CLEAN ? 1.04 : 1.22); // clean 下拉近放大
  stage.frame(cx, cy, halfH);

  // 每件关节世界坐标
  const jointWorld = new Map<string, THREE.Vector3>();
  pup.group.updateWorldMatrix(true, true);
  for (const [name, p] of pup.parts) {
    const v = new THREE.Vector3();
    p.joint.getWorldPosition(v);
    jointWorld.set(name, v);
  }

  const frames = CLIP_FRAMES[5];
  const START = 45, STEP = 18;

  function toScreen(v: THREE.Vector3): [number, number] {
    const n = v.clone().project(stage.camera);
    return [(n.x * 0.5 + 0.5) * W, (1 - (n.y * 0.5 + 0.5)) * H];
  }

  return {
    frames,
    seek(frame: number) {
      stage.render();
      ctx.clearRect(0, 0, W, H);

      // 暗场压一层，让铆点与连线跳出来
      ctx.fillStyle = 'rgba(8,6,10,0.42)';
      ctx.fillRect(0, 0, W, H);

      // 连线（父→子），随 ping 生长
      ctx.lineCap = 'round';
      for (let i = 1; i < ORDER.length; i++) {
        const name = ORDER[i];
        const def = assets.pivots[name];
        if (!def.parent) continue;
        const pingF = START + i * STEP;
        const g = clamp01(seg(frame, pingF, pingF + 12));
        if (g <= 0) continue;
        const [px, py] = toScreen(jointWorld.get(def.parent)!);
        const [xx, yy] = toScreen(jointWorld.get(name)!);
        ctx.strokeStyle = 'rgba(240,184,102,0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(lerp(px, xx, g), lerp(py, yy, g));
        ctx.stroke();
      }

      // 铆点 + ping
      let placed = 0;
      for (let i = 0; i < ORDER.length; i++) {
        const name = ORDER[i];
        const [x, y] = toScreen(jointWorld.get(name)!);
        const isRoot = i === 0;
        const pingF = START + i * STEP;
        if (frame < pingF) continue;
        placed++;
        // ping 圈
        const age = (frame - pingF) / 16;
        if (age >= 0 && age <= 1) {
          ctx.strokeStyle = `rgba(255,100,60,${1 - age})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, lerp(6, 46, age), 0, Math.PI * 2);
          ctx.stroke();
        }
        // 常驻铆点
        if (isRoot) {
          ctx.fillStyle = '#ffe6a8';
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-11, -11, 22, 22);
          ctx.restore();
        } else {
          ctx.fillStyle = '#ff6a3c';
          ctx.shadowColor = 'rgba(255,120,70,0.9)';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#2a0f08';
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const rivets = Math.max(0, placed - 1); // 去掉根件
      setCaption('铆点铰接 · 单轴旋转铰链　<span class="mono">pivotInParent ≙ pivotInSelf</span>');
      setStat(`<div><span class="big">${rivets}</span><span class="unit"> 铆点</span></div><div class="unit">11 件 · 铰链层级树</div>`);
    },
  };
}
