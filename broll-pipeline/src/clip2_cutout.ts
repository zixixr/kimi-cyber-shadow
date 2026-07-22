// 工序 02：扫描线扫过，品红背景 + 内部镂空区变透明（露暗棋盘格）。
import type { ClipCtx } from './main';
import { loadImage, rawURL, keyMagenta } from './assets';
import { CLIP_FRAMES, CLEAN, PANEL, seg, clamp01, setCaption, setStat, type Clip } from './common';

const PART = 'head';
const PX = PANEL.X, PY = PANEL.Y, PW = PANEL.W, PH = PANEL.H;

export async function create(c: ClipCtx): Promise<Clip> {
  const raw = await loadImage(rawURL(PART));
  const keyed = keyMagenta(raw); // 品红/镂空 → 透明，皮件保留
  const { ctx, W, H } = c;

  // 透明棋盘格图案
  const tile = document.createElement('canvas');
  tile.width = tile.height = 48;
  const tctx = tile.getContext('2d')!;
  tctx.fillStyle = '#14110f';
  tctx.fillRect(0, 0, 48, 48);
  tctx.fillStyle = '#1e1915';
  tctx.fillRect(0, 0, 24, 24);
  tctx.fillRect(24, 24, 24, 24);
  const checker = ctx.createPattern(tile, 'repeat')!;

  const frames = CLIP_FRAMES[2];

  return {
    frames,
    seek(frame: number) {
      ctx.clearRect(0, 0, W, H);
      // 扫描进度：0-40 停原图，40-250 扫，250-300 停结果
      const prog = clamp01(seg(frame, 40, 250));
      const scanY = PY + PH * prog;

      // 面板底 + 裁剪
      ctx.save();
      ctx.fillStyle = '#17110f';
      ctx.fillRect(PX - 10, PY - 10, PW + 20, PH + 20);
      ctx.save();
      ctx.beginPath();
      ctx.rect(PX, PY, PW, PH);
      ctx.clip();

      // 处理后的结果层：棋盘格透明底 + 皮件（镂空透出棋盘格）
      ctx.fillStyle = checker;
      ctx.fillRect(PX, PY, PW, PH);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(keyed, PX, PY, PW, PH);

      // 未处理区（扫描线以下）：盖回品红原图
      if (prog < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(PX, scanY, PW, PY + PH - scanY);
        ctx.clip();
        ctx.drawImage(raw, PX, PY, PW, PH);
        ctx.restore();
      }
      ctx.restore(); // panel clip

      // 扫描亮条 + 辉光
      if (prog > 0 && prog < 1) {
        const g = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60);
        g.addColorStop(0, 'rgba(255,214,138,0)');
        g.addColorStop(0.5, 'rgba(255,224,150,0.28)');
        g.addColorStop(1, 'rgba(255,214,138,0)');
        ctx.fillStyle = g;
        ctx.fillRect(PX, scanY - 60, PW, 120);
        ctx.strokeStyle = '#ffe6a8';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255,220,150,0.9)';
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.moveTo(PX, scanY);
        ctx.lineTo(PX + PW, scanY);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // 面板描边（light-table chrome，clean 下隐藏）
      if (!CLEAN) {
        ctx.strokeStyle = 'rgba(240,184,102,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(PX, PY, PW, PH);
      }
      ctx.restore();

      // 名牌（clean 下隐藏）
      if (!CLEAN) {
        const nx = PX + PW + 70;
        ctx.save();
        ctx.fillStyle = 'rgba(207,59,44,0.95)';
        ctx.fillRect(nx, 300, 8, 120);
        ctx.fillStyle = '#f3ddb0';
        ctx.font = '700 78px "PingFang SC","Hiragino Sans GB",sans-serif';
        ctx.fillText('头', nx + 34, 372);
        ctx.fillStyle = 'rgba(240,184,102,0.7)';
        ctx.font = '600 30px "SF Mono",Menlo,monospace';
        ctx.fillText('key_magenta()', nx + 34, 430);
        ctx.restore();
      }

      setCaption('抠除品红背景 + 内部镂空　<span class="mono">色距 &lt; 阈值 ⇒ alpha = 0</span>');
      setStat(`<div><span class="big">${Math.round(prog * 100)}</span><span class="unit"> %</span></div><div class="unit">已抠除</div>`);
    },
  };
}
