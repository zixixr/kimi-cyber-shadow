// 动作对照表：左侧常驻面板，列出全部手势→状态映射（文档 6.2 手势表的可视化），
// 实时高亮当前手势/状态；底部状态行显示信号源 / 手数 / 当前识别结果。

import type { HeroState } from '../hand/director';
import type { Gesture } from '../hand/gestures';

const GESTURE_LABEL: Record<Gesture, string> = {
  none: '无（自然手）',
  open: '五指张开',
  fist: '握拳',
  sword: '剑指',
  point: '食指',
  thumb: '竖拇指',
};

const STATE_LABEL: Record<HeroState, string> = {
  idle: '待机',
  walk: '走',
  run: '跑',
  jump: '跳',
  crouch: '蹲',
  wave: '亮相挥手',
  combo: '拳脚连招',
  staff: '器械套路',
  point: '指向',
  proud: '傲立',
};

interface Row {
  id: string;
  hand: string;
  action: string;
}

const ROWS: Row[] = [
  { id: 'none-move', hand: '🤚 自然手 + 平移手掌', action: '走 / 跑（净位移才走，微晃原地不动）' },
  { id: 'open', hand: '🖐 五指张开', action: '亮相：对观众持续挥手' },
  { id: 'fist', hand: '✊ 握拳（保持即可）', action: '拳脚连招：直拳→抡拳→踢腿→弓步' },
  { id: 'sword', hand: '✌️ 剑指（食+中指）', action: '器械套路：高劈→侧扫→前刺→环绕' },
  { id: 'point', hand: '☝️ 单伸食指', action: '指向：前手 IK 跟随指尖（360°）' },
  { id: 'thumb', hand: '👍 竖拇指', action: '傲立：叉腰扬后手' },
  { id: 'body', hand: '⬆️ 快提 / ⬇️ 压低 / ↔️ 持续同向甩', action: '跳 / 蹲 / 转身' },
  { id: 'depth', hand: '🔦 手掌前推（稳定 0.4s 后生效）', action: '近灯 → 影子变大晕开' },
  { id: 'second', hand: '🐯 第二只手', action: '已预留 → M4 老虎 / M5 第二角色' },
];

export class CheatSheet {
  private rows = new Map<string, HTMLDivElement>();
  private status: HTMLDivElement;

  constructor() {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      left: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '270px',
      padding: '12px 14px',
      zIndex: '10',
      background: 'rgba(10,8,6,0.82)',
      border: '1px solid #c8a05a44',
      borderRadius: '4px',
      color: '#d9c39a',
      font: '12px "Songti SC", "Noto Serif SC", serif',
      lineHeight: '1.45',
      letterSpacing: '0.04em',
    } as Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = '动作对照表';
    Object.assign(title.style, {
      fontSize: '13px',
      color: '#c8a05a',
      marginBottom: '8px',
      letterSpacing: '0.2em',
    } as Partial<CSSStyleDeclaration>);
    panel.appendChild(title);

    for (const r of ROWS) {
      const div = document.createElement('div');
      div.innerHTML = `<span style="opacity:.95">${r.hand}</span><br><span style="opacity:.65">→ ${r.action}</span>`;
      Object.assign(div.style, {
        padding: '4px 6px',
        margin: '2px 0',
        borderRadius: '3px',
        borderLeft: '2px solid transparent',
        transition: 'background .15s',
      } as Partial<CSSStyleDeclaration>);
      panel.appendChild(div);
      this.rows.set(r.id, div);
    }

    this.status = document.createElement('div');
    Object.assign(this.status.style, {
      marginTop: '8px',
      paddingTop: '6px',
      borderTop: '1px solid #c8a05a33',
      color: '#37e6a0',
      fontSize: '12px',
    } as Partial<CSSStyleDeclaration>);
    panel.appendChild(this.status);
    document.body.appendChild(panel);
  }

  /** 每帧更新高亮与状态行 */
  update(info: { gesture: Gesture | null; state: HeroState | null; hands: number; source: string }): void {
    let active = '';
    if (info.gesture && info.gesture !== 'none') active = info.gesture;
    else if (info.state === 'walk' || info.state === 'run') active = 'none-move';
    else if (info.state === 'jump' || info.state === 'crouch') active = 'body';
    for (const [id, div] of this.rows) {
      const on = id === active;
      div.style.background = on ? '#c8a05a22' : 'transparent';
      div.style.borderLeft = on ? '2px solid #37e6a0' : '2px solid transparent';
    }
    this.status.textContent =
      info.gesture === null
        ? `${info.source} · 未检测到手`
        : `${info.source} · 手×${info.hands} · ${GESTURE_LABEL[info.gesture]} → ${STATE_LABEL[info.state ?? 'idle']}`;
  }
}
