// MediaPipe HandLandmarker 21 关键点索引常量（官方拓扑，序号不可改）。
// 集中定义避免魔法数字散落；gestures.ts / mediapipe.ts 都从这里取。
// 拓扑：0=腕；1-4=拇指（CMC/MCP/IP/TIP）；5-8=食指；9-12=中指；13-16=无名指；17-20=小指。

/** 腕 */
export const WRIST = 0;

/** 拇指：腕掌 / 掌指 / 指间 / 指尖 */
export const THUMB_CMC = 1;
export const THUMB_MCP = 2;
export const THUMB_IP = 3;
export const THUMB_TIP = 4;

/** 食指：根（掌指）/ 近节 / 远节 / 指尖 */
export const INDEX_MCP = 5;
export const INDEX_PIP = 6;
export const INDEX_DIP = 7;
export const INDEX_TIP = 8;

/** 中指：9 = 中指根（掌长终点，手势比率分母的锚点，文档 6.3 铁律①） */
export const MIDDLE_MCP = 9;
export const MIDDLE_PIP = 10;
export const MIDDLE_DIP = 11;
export const MIDDLE_TIP = 12;

/** 无名指 */
export const RING_MCP = 13;
export const RING_PIP = 14;
export const RING_DIP = 15;
export const RING_TIP = 16;

/** 小指 */
export const PINKY_MCP = 17;
export const PINKY_PIP = 18;
export const PINKY_DIP = 19;
export const PINKY_TIP = 20;

/** 五指指尖（拇指→小指），调试用连线/描点 */
export const FINGER_TIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP] as const;

/** 掌心采样点：腕 + 四指根。均值比单腕稳，用作掌心位置与指向基准 */
export const PALM_POINTS = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP] as const;
