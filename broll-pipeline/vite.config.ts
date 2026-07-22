import { defineConfig } from 'vite'

// 独立 B-roll 管线可视化页面（与主项目隔离）。
// 运行：npx vite --config broll-pipeline/vite.config.ts --port 5174
// 只读复制的素材放在 broll-pipeline/public/data/ 下，按 URL 加载。
export default defineConfig({
  root: 'broll-pipeline',
  publicDir: 'public',
  server: { port: 5174, strictPort: true },
})
