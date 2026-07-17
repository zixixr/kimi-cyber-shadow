import { cpSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    {
      name: 'copy-runtime-assets',
      // assets/ 是运行时按 URL 加载的贴图/音效（非 import 资源），构建后拷进 dist
      closeBundle() {
        cpSync('assets', 'dist/assets', { recursive: true })
      },
    },
  ],
})
