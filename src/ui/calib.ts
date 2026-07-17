// 姿势标定模式（?debug=calib，文档 6.6 基础版）：←/→ 方向键切换预设 FK 姿势，
// 顶部常驻显示姿势名 + u/e 角度 + 核对要点，供肉眼确认「脸朝哪、手臂实际指向哪」。
// 方向/符号问题一律用眼睛定死、不靠解析推导——这是本项目血泪换来的方法论。
// 本阶段只做基础版：方向键切姿势；拖点标定（按 t）留到 M7（文档第 8 章）。

import type { Puppet } from '../puppet/assembly';

interface CalibPose {
  name: string;
  note: string;
  front: { u: number; e: number };
  rear: { u: number; e: number };
  legs?: { front: number; back: number };
}

/** 预设姿势清单：先单关节基准（核对 u/e 符号），再状态机定格（核对连招朝向） */
const POSES: CalibPose[] = [
  { name: '垂手待机', note: 'u=0 双臂应竖直下垂', front: { u: 0, e: 12 }, rear: { u: 0, e: 12 } },
  { name: '前手平举', note: 'u=90 应水平指向面向侧', front: { u: 90, e: 0 }, rear: { u: 0, e: 12 } },
  { name: '前手上举', note: 'u=180 应竖直向上', front: { u: 180, e: 0 }, rear: { u: 0, e: 12 } },
  { name: '前手后摆', note: 'u=-60 应摆向身后', front: { u: -60, e: 0 }, rear: { u: 0, e: 12 } },
  { name: '前手屈肘', note: 'u=60 e=90 肘尖应折向身后', front: { u: 60, e: 90 }, rear: { u: 0, e: 12 } },
  { name: '亮相（张开定格）', note: '前手高扬挥位，后手后展', front: { u: 148, e: 28 }, rear: { u: -122, e: 25 } },
  { name: '傲立（拇指定格）', note: '前手叉腰、后手扬起', front: { u: 30, e: 105 }, rear: { u: -75, e: 45 } },
  { name: '高劈（剑指①）', note: '前手抡至前上方', front: { u: 160, e: 20 }, rear: { u: -60, e: 45 } },
  { name: '前刺（剑指③）', note: '臂应基本伸直、向面向侧送出', front: { u: 88, e: 3 }, rear: { u: -70, e: 30 } },
  { name: '踢腿（连招③）', note: '前腿应向前抬起，双拳收架', front: { u: 75, e: 112 }, rear: { u: -35, e: 118 }, legs: { front: 0.85, back: -0.3 } },
];

export class CalibMode {
  private puppet: Puppet;
  private idx = 0;
  private label: HTMLDivElement;

  constructor(puppet: Puppet) {
    this.puppet = puppet;
    this.label = document.createElement('div');
    Object.assign(this.label.style, {
      position: 'fixed',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 18px',
      zIndex: '20',
      background: 'rgba(10,8,6,0.88)',
      border: '1px solid #c8a05a66',
      borderRadius: '4px',
      color: '#d9c39a',
      font: '13px/1.7 "Songti SC", "Noto Serif SC", serif',
      textAlign: 'center',
      letterSpacing: '0.06em',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.label);
    addEventListener('keydown', this.onKey);
    this.show();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      this.idx = (this.idx + 1) % POSES.length;
      this.show();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      this.idx = (this.idx - 1 + POSES.length) % POSES.length;
      this.show();
      e.preventDefault();
    }
  };

  private show(): void {
    const p = POSES[this.idx];
    this.label.innerHTML =
      `姿势标定 ${this.idx + 1}/${POSES.length}：<b>${p.name}</b><br>` +
      `<span style="color:#c8a05a">前手 u=${p.front.u} e=${p.front.e} · 后手 u=${p.rear.u} e=${p.rear.e}` +
      (p.legs ? ` · 腿 f=${p.legs.front} b=${p.legs.back}` : '') +
      `</span><br><span style="opacity:.75">${p.note}</span><br>` +
      `<span style="opacity:.45">←/→ 切换姿势 · 肉眼核对朝向与符号</span>`;
  }

  /** 每帧应用当前姿势（FK；Puppet.update 内 dt×14 平滑插值，标定看的是稳态） */
  update(): void {
    const p = POSES[this.idx];
    this.puppet.setArmPose(p.front.u, p.front.e, 'front');
    this.puppet.setArmPose(p.rear.u, p.rear.e, 'back');
    this.puppet.setLegPose(p.legs ? p.legs.front : null, p.legs ? p.legs.back : null);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    this.label.remove();
  }
}
