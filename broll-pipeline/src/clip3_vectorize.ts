// 工序 03：亮色描边沿真实外轮廓（geometry.json）逐渐生长，锚点闪现。
import type { ClipCtx } from './main';
import { loadImage, rawURL, keyMagenta } from './assets';
import { CLIP_FRAMES, CLEAN, PANEL, seg, easeInOut, clamp01, lerp, setCaption, setStat, type Clip } from './common';

const PART = 'head';
const PX = PANEL.X, PY = PANEL.Y, PW = PANEL.W, PH = PANEL.H;

export async function create(c: ClipCtx): Promise<Clip> {
  const raw = await loadImage(rawURL(PART));
  const ghost = keyMagenta(raw);
  const { ctx, W, H, assets } = c;

  const outline = assets.parts[PART].outline; // 归一化 (x,y) y 向下
  const pts = outline.map(([x, y]) => [PX + x * PW, PY + y * PH] as [number, number]);
  const N = pts.length;
  // 累积周长
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i <= N; i++) {
    const a = pts[i - 1];
    const b = pts[i % N];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum.push(total);
  }
  const vprog = pts.map((_, i) => cum[i] / total); // 每个锚点被描到的进度

  const frames = CLIP_FRAMES[3];

  return {
    frames,
    seek(frame: number) {
      ctx.clearRect(0, 0, W, H);
      const prog = easeInOut(clamp01(seg(frame, 30, 320)));
      const drawn = total * prog;

      ctx.save();
      ctx.fillStyle = '#100d0c';
      ctx.fillRect(PX - 10, PY - 10, PW + 20, PH + 20);
      ctx.save();
      ctx.beginPath();
      ctx.rect(PX - 10, PY - 10, PW + 20, PH + 20);
      ctx.clip();

      // 幽灵参考皮件（很淡）
      ctx.globalAlpha = 0.16;
      ctx.drawImage(ghost, PX, PY, PW, PH);
      ctx.globalAlpha = 1;

      // 已完成后填一层极淡暖色，强调"闭合矢量形"
      if (prog >= 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < N; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = 'rgba(240,184,102,0.10)';
        ctx.fill();
      }

      // 生长的描边
      ctx.strokeStyle = '#ffd68a';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255,210,130,0.85)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      let tip = pts[0];
      for (let i = 1; i <= N; i++) {
        const segEnd = cum[i];
        const a = pts[i - 1];
        const b = pts[i % N];
        if (segEnd <= drawn) {
          ctx.lineTo(b[0], b[1]);
          tip = b;
        } else {
          const segStart = cum[i - 1];
          const f = (drawn - segStart) / (segEnd - segStart);
          const px = lerp(a[0], b[0], f), py = lerp(a[1], b[1], f);
          ctx.lineTo(px, py);
          tip = [px, py];
          break;
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 已落定锚点 + 锚点 ping
      let placed = 0;
      for (let i = 0; i < N; i++) {
        if (vprog[i] > prog) continue;
        placed++;
        const [x, y] = pts[i];
        // 常驻锚点方块
        ctx.fillStyle = 'rgba(255,224,160,0.9)';
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        // ping：描边刚经过时闪一圈
        const age = (prog - vprog[i]) / 0.045;
        if (age >= 0 && age <= 1) {
          ctx.strokeStyle = `rgba(255,90,60,${1 - age})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, lerp(5, 34, age), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 生长尖端亮点
      if (prog > 0 && prog < 1) {
        ctx.fillStyle = '#fff2d0';
        ctx.shadowColor = 'rgba(255,220,150,1)';
        ctx.shadowBlur = 26;
        ctx.beginPath();
        ctx.arc(tip[0], tip[1], 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore(); // clip

      // 面板描边（light-table chrome，clean 下隐藏）
      if (!CLEAN) {
        ctx.strokeStyle = 'rgba(240,184,102,0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(PX - 10, PY - 10, PW + 20, PH + 20);
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
        ctx.fillText('trace_outline()', nx + 34, 430);
        ctx.restore();
      }

      setCaption('外轮廓矢量化 · Douglas–Peucker 简化　<span class="mono">find_contours → RDP</span>');
      setStat(`<div><span class="big">${placed}</span><span class="unit"> / ${N}</span></div><div class="unit">轮廓锚点</div>`);
    },
  };
}
