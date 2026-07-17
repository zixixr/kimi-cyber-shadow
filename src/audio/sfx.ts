// 音效模块（M4）：WebAudio 播放皮影戏锣鼓点。
// 素材：Freesound CC0/CC-BY（署名见 assets/sfx/<类目>/ 侧车 JSON）。
// 映射（文档第 7 章）：锣=命中、太鼓=出招、吼=虎扑/咆哮、断木=断棒、BGM=锣鼓循环底乐。
// 浏览器自动播放策略：AudioContext 首次用户交互（pointerdown/keydown）后才 resume，
// 因此 main 在首次交互时调 unlock()；此前 play() 静默丢弃不报错。

const FILES: Record<string, string> = {
  gong: '/assets/sfx/gong.mp3', // 击中锣
  drum: '/assets/sfx/drum.mp3', // 出招太鼓
  roar: '/assets/sfx/roar.mp3', // 虎扑 / 咆哮
  crack: '/assets/sfx/crack.mp3', // 哨棒断裂 / 打树
  bgm: '/assets/sfx/bgm.mp3', // 锣鼓底乐（循环）
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  private loopSrc: AudioBufferSourceNode | null = null;

  /** 建 AudioContext 并预载全部音效；单个缺失不阻塞（无声也能玩） */
  async init(): Promise<void> {
    this.ctx = new AudioContext();
    await Promise.all(
      Object.entries(FILES).map(async ([name, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, buf);
        } catch {
          /* 单个音效缺失不阻塞 */
        }
      }),
    );
  }

  /** 首次用户交互后调用：解锁音频并开播 BGM 锣鼓循环（重复调用无害） */
  unlock(bgmVolume = 0.22): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startLoop('bgm', bgmVolume);
  }

  /** 循环底乐：已在播则忽略 */
  startLoop(name: string, volume = 0.25): void {
    if (!this.ctx || this.loopSrc) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
    this.loopSrc = src;
  }

  /**
   * 播放一次；同名并发各自独立。
   * @param rate   playbackRate（<1 降调，伏诛大锣用 0.6/0.5）
   * @param minGap 秒内重复调用忽略（防每帧触发）
   */
  play(name: string, opts: { volume?: number; rate?: number; minGap?: number } = {}): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlay.get(name) ?? -9) < (opts.minGap ?? 0.08)) return;
    this.lastPlay.set(name, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }
}
