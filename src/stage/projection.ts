// 彩色透光投影核心：灯位相机把影人层（layer 1）渲进透明底 RenderTarget，
// 按影人到幕布的深度做分离式高斯模糊（贴幕锐、近灯虚），
// 幕布 shader 把模糊后的影子与暖白幕布相乘，并叠灯心热区高光。
//
// 已落实文档第 5 章四个坑：
//  ① 投影 pass 前 scene.background = null，渲完还原（否则背景色盖掉 RT 透明底）；
//  ② 灯光 layers.enable(1) —— 在 theater.ts 的 lampLight / ambient 上；
//  ③ 投影 pass 期间皮革材质 transmission 临时置 0 —— 由 update 的 before/after 钩子实现，
//     后续 Puppet 用 transmissionGuard() 注册；
//  ④ 幕布采样 RT 时 uv.x 翻转（幕布法线朝 -z 且绕 y 转了 180°）。

import * as THREE from 'three';
import { LAMP_POS, SCREEN_CY, SCREEN_H, SCREEN_W } from './theater';

/** 投影 RT 分辨率：横向 1024，竖向按幕布宽高比折算 */
const RT_W = 1024;
const RT_H = Math.round((RT_W * SCREEN_H) / SCREEN_W);

/** 最大模糊半径（像素）：贴幕 0、近灯 ≈9 */
const MAX_BLUR_PX = 9;

/** 投影 pass 的前/后钩子（坑③：Puppet 在此临时改写皮革材质，投完还原） */
export interface ProjectionHooks {
  before?: () => void;
  after?: () => void;
}

/** 生成一对钩子：投影 pass 期间把皮革材质的 transmission 临时置 0，投完还原。 */
export function transmissionGuard(materials: THREE.MeshPhysicalMaterial[]): ProjectionHooks {
  const saved: number[] = [];
  return {
    before: () => {
      materials.forEach((m, i) => {
        saved[i] = m.transmission;
        m.transmission = 0;
      });
    },
    after: () => {
      materials.forEach((m, i) => {
        m.transmission = saved[i] ?? 0;
      });
    },
  };
}

/** 单方向高斯模糊材质（17 taps，半径 0 时退化为原图） */
function makeBlurMaterial(dir: [number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tex: { value: null as THREE.Texture | null },
      radius: { value: 0 },
      texel: { value: new THREE.Vector2(dir[0] / RT_W, dir[1] / RT_H) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tex;
      uniform float radius;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec4 acc = vec4(0.0);
        float wsum = 0.0;
        for (int i = -8; i <= 8; i++) {
          float w = exp(-float(i * i) / max(1.0, 2.0 * radius * radius));
          acc += texture2D(tex, vUv + texel * float(i) * max(radius * 0.5, 0.001)) * w;
          wsum += w;
        }
        gl_FragColor = acc / wsum;
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

export class ShadowProjection {
  /** 幕布材质：搭舞台时传给 buildTheater() */
  readonly screenMaterial: THREE.ShaderMaterial;

  private rtShadow = new THREE.WebGLRenderTarget(RT_W, RT_H); // 影人层原图
  private rtA = new THREE.WebGLRenderTarget(RT_W, RT_H); // 横向模糊中间结果
  private rtB = new THREE.WebGLRenderTarget(RT_W, RT_H); // 竖向模糊最终结果（幕布采样它）
  private lampCam: THREE.PerspectiveCamera; // 灯位相机，只看 layer 1
  private quadScene = new THREE.Scene(); // 全屏四边形场景（模糊 pass 用）
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private blurH = makeBlurMaterial([1, 0]);
  private blurV = makeBlurMaterial([0, 1]);

  constructor() {
    // 灯位相机：放在灯处看幕心，FOV 刚好覆盖幕布
    const dist = LAMP_POS.z;
    const fov = 2 * Math.atan(SCREEN_H / 2 / dist) * (180 / Math.PI);
    this.lampCam = new THREE.PerspectiveCamera(fov, SCREEN_W / SCREEN_H, 0.02, dist + 0.1);
    this.lampCam.position.copy(LAMP_POS);
    this.lampCam.lookAt(0, SCREEN_CY, 0);
    this.lampCam.layers.set(1); // 只看影人层

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurH);
    this.quadScene.add(this.quad);

    this.screenMaterial = new THREE.ShaderMaterial({
      uniforms: {
        shadowTex: { value: this.rtB.texture },
        baseColor: { value: new THREE.Color(0xf5e8d0) }, // 暖白幕布底色
        lampGlow: { value: new THREE.Color(0xffe0b0) }, // 灯光暖色
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D shadowTex;
        uniform vec3 baseColor;
        uniform vec3 lampGlow;
        varying vec2 vUv;
        void main() {
          // 坑④：幕布法线朝 -z 且绕 y 转了 180°，u 翻转才对齐灯位相机视角
          vec2 uv = vec2(1.0 - vUv.x, vUv.y);
          vec4 sh = texture2D(shadowTex, uv);
          // 灯心热区：幕心亮、边缘暗
          float d = distance(vUv, vec2(0.5));
          float hot = 0.72 + 0.5 * exp(-d * d * 6.0);
          vec3 lit = baseColor * hot * lampGlow;
          // 皮影透光：影区 = 皮色 × 透光率（随热区一起衰减）
          vec3 col = mix(lit, sh.rgb * 0.92 * hot, sh.a);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
  }

  /**
   * 每帧更新投影：影人层 → RT → 距离模糊 → 幕布贴图。
   * @param depthRatio 影人到幕布的归一化深度：0=贴幕（影锐），1=近灯（影虚）。
   *                   后续 Puppet 按自身平均深度计算；M0 由占位影人给出。
   * @param hooks      投影 pass 前/后钩子（坑③，见 transmissionGuard）
   */
  update(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    depthRatio: number,
    hooks?: ProjectionHooks,
  ): void {
    hooks?.before?.();

    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    const prevBg = scene.background;
    scene.background = null; // 坑①：scene.background 会覆盖 RT 的透明底

    // 1) 灯位相机把影人层渲进 RT（透明底）
    renderer.setRenderTarget(this.rtShadow);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, this.lampCam);

    // 2) 分离式高斯模糊：横向 → 竖向，半径随深度变化
    const radius = THREE.MathUtils.clamp(depthRatio, 0, 1) * MAX_BLUR_PX;
    this.blurH.uniforms.tex.value = this.rtShadow.texture;
    this.blurH.uniforms.radius.value = radius;
    this.quad.material = this.blurH;
    renderer.setRenderTarget(this.rtA);
    renderer.clear();
    renderer.render(this.quadScene, this.quadCam);

    this.blurV.uniforms.tex.value = this.rtA.texture;
    this.blurV.uniforms.radius.value = radius;
    this.quad.material = this.blurV;
    renderer.setRenderTarget(this.rtB);
    renderer.clear();
    renderer.render(this.quadScene, this.quadCam);

    // 还原渲染状态
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    scene.background = prevBg;

    hooks?.after?.();
  }
}
