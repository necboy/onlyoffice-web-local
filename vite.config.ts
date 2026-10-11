import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import viteCompression from 'vite-plugin-compression'

// ONLYOFFICE 的静态脚本没有文件名哈希，显式版本可隔离 CDN 的旧 gzip 缓存。
const officeAssetHash = createHash('sha256')
for (const editor of ['documenteditor', 'spreadsheeteditor', 'presentationeditor']) {
    for (const file of ['app.js', 'index.html']) {
        officeAssetHash.update(readFileSync(new URL(`./public/web-apps/apps/${editor}/main/${file}`, import.meta.url)))
    }
}
officeAssetHash.update(readFileSync(new URL('./public/web-apps/apps/api/documents/api.js', import.meta.url)))
const officeAssetVersion = officeAssetHash.digest('hex').slice(0, 16)
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd())
    return {
      base: './',
      define: {
        'import.meta.env.VITE_OFFICE_ASSET_VERSION': JSON.stringify(officeAssetVersion),
      },
      server: {
        port: parseInt(env.VITE_PORT) || 3000,
        host: '0.0.0.0',
        // 允许 Vite 处理带中文文件名或外部 URL 参数的请求
        fs: { allow: ['..', '/'] },
        cors: true,
      },
      build: {
        outDir: 'html',
      },
      plugins: [
        AutoImport({
          resolvers: [ElementPlusResolver()],
        }),
        Components({
          resolvers: [ElementPlusResolver()],
        }),
        vue(),
        vueJsx(),
        vueDevTools(),
        viteCompression({
          filter: /\.(js|css|json|txt|ico|svg|wasm)(\?.*)?$/i, // 需要压缩的文件
          threshold: 1024, // 文件容量大于这个值进行压缩
          algorithm: 'gzip', // 压缩方式
          ext: 'gz', // 后缀名
          deleteOriginFile: false, // 压缩后是否删除压缩源文件
        }),
      ],
      resolve: {
        alias: {
          '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
      },
    }
})

