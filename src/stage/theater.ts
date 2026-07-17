// 舞台模块：暖白幕布、木台框、幕后点光源（油灯）、体积光锥、光路浮尘。
// 世界系约定：幕布平面 z=0，观众侧 z<0，幕后（灯与影人）z>0。

import * as THREE from 'three';

export const SCREEN_W = 1.8; // 幕布宽（米）
export const SCREEN_H = 1.2; // 幕布高（米）
export const SCREEN_CY = 1.1; // 幕布中心离地高（米）
export const LAMP_POS = new THREE.Vector3(0, SCREEN_CY, 0.85); // 灯位：幕后 0.85m，正对幕心

export interface Theater {
  group: THREE.Group;
  screen: THREE.Mesh; // 幕布网格（材质由投影模块提供）
  lampLight: THREE.PointLight; // 幕后点光源
  dust: THREE.Points; // 光路浮尘
  update(dt: number, t: number): void;
}

/** 搭建舞台。幕布材质由外部传入（投影模块的 shader 材质），其余自建。 */
export function buildTheater(screenMaterial: THREE.Material): Theater {
  const group = new THREE.Group();

  // 幕布：面向观众（-z）
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), screenMaterial);
  screen.position.set(0, SCREEN_CY, 0);
  screen.rotation.y = Math.PI;
  group.add(screen);

  // 木台框：四边条 + 底台
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.85 });
  const frameT = 0.09;
  const bars: ReadonlyArray<readonly [number, number, number, number]> = [
    [SCREEN_W + frameT * 2, frameT, 0, SCREEN_CY + SCREEN_H / 2 + frameT / 2], // 上梁
    [SCREEN_W + frameT * 2, frameT, 0, SCREEN_CY - SCREEN_H / 2 - frameT / 2], // 下梁
    [frameT, SCREEN_H + frameT * 2, -(SCREEN_W / 2 + frameT / 2), SCREEN_CY], // 左柱
    [frameT, SCREEN_H + frameT * 2, SCREEN_W / 2 + frameT / 2, SCREEN_CY], // 右柱
  ];
  for (const [w, h, x, y] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), wood);
    bar.position.set(x, y, 0);
    group.add(bar);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.6, 0.5, 1.6), wood);
  base.position.set(0, SCREEN_CY - SCREEN_H / 2 - frameT - 0.25, 0.4);
  group.add(base);

  // 地面
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // 油灯：灯座 + 发光灯芯 + 点光源
  const lampBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 0.1, 16),
    new THREE.MeshStandardMaterial({ color: 0x6b4a1f, roughness: 0.6, metalness: 0.4 }),
  );
  lampBase.position.copy(LAMP_POS).add(new THREE.Vector3(0, -0.09, 0));
  group.add(lampBase);

  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffc966 }),
  );
  flame.position.copy(LAMP_POS);
  group.add(flame);

  const lampLight = new THREE.PointLight(0xffc077, 8, 8, 1.6);
  lampLight.position.copy(LAMP_POS);
  // 坑②：投影 pass 的灯位相机只看 layer 1，灯光必须也在 layer 1，否则影人全黑
  lampLight.layers.enable(1);
  group.add(lampLight);

  const ambient = new THREE.AmbientLight(0x24180f, 1.2);
  ambient.layers.enable(1);
  group.add(ambient);

  // 体积光锥（灯 → 幕布，additive 假体积）
  const coneLen = LAMP_POS.z;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(SCREEN_H * 0.62, coneLen, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffb866,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  cone.position.set(0, SCREEN_CY, coneLen / 2);
  cone.rotation.x = -Math.PI / 2;
  group.add(cone);

  // 光路浮尘
  const N = 800;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 1.6;
    pos[i * 3 + 1] = SCREEN_CY + (Math.random() - 0.5) * 1.1;
    pos[i * 3 + 2] = Math.random() * coneLen * 0.95;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xffd9a0,
      size: 0.004,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(dust);

  const flamePhase = Math.random() * 10;

  return {
    group,
    screen,
    lampLight,
    dust,
    update(_dt: number, t: number) {
      // 灯芯呼吸 + 光强微颤
      const flicker = 1 + Math.sin(t * 9 + flamePhase) * 0.06 + Math.sin(t * 23) * 0.03;
      lampLight.intensity = 8 * flicker;
      flame.scale.setScalar(flicker);
      // 浮尘布朗漂移
      const p = dustGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        p.array[i * 3] += (Math.random() - 0.5) * 0.0006;
        p.array[i * 3 + 1] += (Math.random() - 0.48) * 0.0005;
      }
      p.needsUpdate = true;
    },
  };
}
