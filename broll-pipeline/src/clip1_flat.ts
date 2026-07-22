// 工序 01：品红底平面皮件逐件展示（缓推 + 快切）。展示"这是 AI 生成的原始图"。
import type { ClipCtx } from './main';
import { loadImage, rawURL } from './assets';
import { CLIP_FRAMES, ZH, CLEAN, PANEL, seg, easeOut, clamp01, setCaption, setStat, type Clip } from './common';

const ORDER = ['head', 'chest', 'belly', 'upper_arm_f', 'lower_arm_f', 'hand_f', 'hand_fist', 'leg_f', 'leg_b'];

// 面板（光台）几何（clean 下居中放大占满画面，取自 PANEL）
const PX = PANEL.X, PY = PANEL.Y, PW = PANEL.W, PH = PANEL.H;

export async function create(c: ClipCtx): Promise<Clip> {
  const imgs = await Promise.all(ORDER.map((n) => loadImage(rawURL(n))));
  const frames = CLIP_FRAMES[1];
  const per = frames / ORDER.length; // 40

  const { ctx, W, H } = c;

  function drawPanel(cutFlash: number, idx: number, push: number) {
    // 面板底：略亮暖灰 + 内阴影，仿透光光台
    ctx.save();
    ctx.fillStyle = '#17110f';
    ctx.fillRect(PX - 10, PY - 10, PW + 20, PH + 20);
    // 品红图（contain，缓推放大，裁到面板内）
    ctx.save();
    ctx.beginPath();
    ctx.rect(PX, PY, PW, PH);
    ctx.clip();
    const size = PW * (1 + 0.06 * push);
    const cx = PX + PW / 2, cy = PY + PH / 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgs[idx], cx - size / 2, cy - size / 2, size, size);
    ctx.restore();

    // 面板暖色描边 + 角部登记刻线（light-table chrome，clean 下隐藏，只留皮件本体）
    if (!CLEAN) {
      ctx.strokeStyle = 'rgba(240,184,102,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(PX, PY, PW, PH);
      ctx.strokeStyle = 'rgba(255,214,138,0.95)';
      ctx.lineWidth = 3;
      const t = 34;
      for (const [ox, oy, sx, sy] of [
        [PX, PY, 1, 1], [PX + PW, PY, -1, 1], [PX, PY + PH, 1, -1], [PX + PW, PY + PH, -1, -1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(ox, oy + sy * t); ctx.lineTo(ox, oy); ctx.lineTo(ox + sx * t, oy);
        ctx.stroke();
      }
    }

    // 快切闪条（前 4 帧一道暖光横扫）
    if (cutFlash > 0) {
      const y = PY + PH * (1 - cutFlash);
      const grad = ctx.createLinearGradient(0, y - 40, 0, y + 40);
      grad.addColorStop(0, 'rgba(255,214,138,0)');
      grad.addColorStop(0.5, `rgba(255,220,150,${0.55 * cutFlash})`);
      grad.addColorStop(1, 'rgba(255,214,138,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(PX, y - 40, PW, 80);
    }
    ctx.restore();

    // 部件名牌（面板右侧）——clean 下隐藏（件名列由 Remotion 包装层统一处理）
    if (CLEAN) return;
    const name = ZH[ORDER[idx]] ?? ORDER[idx];
    const nx = PX + PW + 70;
    ctx.save();
    ctx.fillStyle = 'rgba(207,59,44,0.95)';
    ctx.fillRect(nx, 300, 8, 120);
    ctx.fillStyle = '#f3ddb0';
    ctx.font = '700 78px "PingFang SC","Hiragino Sans GB",sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, nx + 34, 372);
    ctx.fillStyle = 'rgba(240,184,102,0.7)';
    ctx.font = '600 30px "SF Mono",Menlo,monospace';
    ctx.fillText(`part_${ORDER[idx]}`, nx + 34, 430);
    // 小注：一件的胶片格进度点
    for (let k = 0; k < ORDER.length; k++) {
      ctx.fillStyle = k === idx ? '#ffd68a' : 'rgba(240,184,102,0.25)';
      ctx.beginPath();
      ctx.arc(nx + 20 + k * 40, 560, k === idx ? 11 : 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    frames,
    seek(frame: number) {
      ctx.clearRect(0, 0, W, H);
      const idx = Math.min(ORDER.length - 1, Math.floor(frame / per));
      const local = frame - idx * per;
      const push = easeOut(clamp01(local / (per - 2)));
      const cutFlash = clamp01(1 - seg(local, 0, 4)); // 前 4 帧
      drawPanel(cutFlash, idx, push);

      setCaption('GPT Image 2 生成 · 品红底 <span class="mono">#FF00FF</span>　平面正视皮件');
      setStat(`<div><span class="big">${String(idx + 1).padStart(2, '0')}</span> <span class="unit">/ ${ORDER.length} 件</span></div>`);
    },
  };
}
