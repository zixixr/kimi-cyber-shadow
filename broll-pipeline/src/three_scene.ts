// 共用 three 场景：#gl 画布上的渲染器 + 暖色车间打光 + 正交相机。B-roll 用（clip 4/5/6）。
import * as THREE from 'three';

export interface Stage3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  /** 设正交取景：中心 (cx,cy)、半高 halfH（米），16:9。 */
  frame(cx: number, cy: number, halfH: number): void;
  render(): void;
}

const ASPECT = 1920 / 1080;

export function makeStage(gl: HTMLCanvasElement): Stage3D {
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(2);
  renderer.setSize(1920, 1080, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0); // 透明，露出 CSS 暗色车间底

  const scene = new THREE.Scene();

  // 暖色环境 + 主光（皮影暖黄）+ 朱红逆光描边
  scene.add(new THREE.AmbientLight(0x4a3524, 0.9));
  const key = new THREE.DirectionalLight(0xffd8a0, 2.4);
  key.position.set(0.5, 0.9, 1.2);
  scene.add(key);
  const warmFront = new THREE.DirectionalLight(0xffb060, 1.0);
  warmFront.position.set(-0.4, 0.2, 1.0);
  scene.add(warmFront);
  const rim = new THREE.DirectionalLight(0xd8482a, 1.4);
  rim.position.set(-0.6, 0.4, -1.0);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffcf80, 0.8);
  rim2.position.set(0.7, -0.3, -0.8);
  scene.add(rim2);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.position.set(0, 0, 10);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);

  function frame(cx: number, cy: number, halfH: number) {
    const halfW = halfH * ASPECT;
    camera.left = cx - halfW;
    camera.right = cx + halfW;
    camera.top = cy + halfH;
    camera.bottom = cy - halfH;
    camera.updateProjectionMatrix();
  }

  return { renderer, scene, camera, frame, render: () => renderer.render(scene, camera) };
}
