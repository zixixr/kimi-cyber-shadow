// 被动摆锤腿：根节点水平加速度驱动甩腿（真实皮影的腿不做主动驱动，靠惯性甩）。
// 接口：每帧 update(dt, 根水平加速度) → 当前腿摆角（弧度）。

export class PendulumLeg {
  /** 当前摆角（弧度）：髋竖直下垂为 0，向前甩为正 */
  theta = 0;
  /** 角速度（弧度/秒） */
  omega = 0;

  private k: number; // 回复刚度（重力等效）
  private c: number; // 阻尼
  private gain: number; // 根加速度 → 甩腿的耦合增益

  constructor(k = 26, c = 3.2, gain = 0.9) {
    this.k = k;
    this.c = c;
    this.gain = gain;
  }

  /** 积分一步，返回限位后的摆角。 */
  update(dt: number, rootAccelX: number): number {
    // 惯性力矩：根加速时腿因惯性反向甩，乘 cos 近似小角下的力臂
    const drive = -rootAccelX * this.gain * Math.cos(this.theta);
    this.omega += (-this.k * this.theta - this.c * this.omega + drive) * dt;
    this.theta += this.omega * dt;
    // 物理限位 ±50°（pivots.json 腿件 limits），撞限反弹衰减
    const lim = (Math.PI * 50) / 180;
    if (this.theta > lim) {
      this.theta = lim;
      this.omega *= -0.3;
    } else if (this.theta < -lim) {
      this.theta = -lim;
      this.omega *= -0.3;
    }
    return this.theta;
  }
}
