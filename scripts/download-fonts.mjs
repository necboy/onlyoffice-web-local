import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { root, validateFont, run } from './fonts.mjs'

// 只读取经维护者审阅并固定 SHA-256 的清单；不执行下载内容。
const directory = mkdtempSync(join(tmpdir(), 'onlyoffice-fonts-'))
try {
  const spec = JSON.parse(readFileSync(resolve(root, 'config/font-downloads.json'), 'utf8'))
  const pending = [...spec.fonts]
  const results = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    while (pending.length) {
      const item = pending.shift()
      if (!/^[a-zA-Z0-9_.-]+\.(ttf|ttc|otf)$/i.test(item.file) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 12 || item.bytes > 30 * 1024 * 1024) throw new Error('下载清单无效')
      const url = new URL(item.source)
      if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || !/^\/[^/]+\/[^/]+\/[a-f0-9]{40}\//.test(url.pathname)) throw new Error('字体来源必须固定 GitHub commit，并使用 HTTPS')
      const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' })
      if (!response.ok) throw new Error(`${item.file}: HTTP ${response.status}`)
      const blocks = []
      let size = 0
      for await (const block of response.body) {
        size += block.length
        if (size > item.bytes) throw new Error(`${item.file}: 下载超出清单大小`)
        blocks.push(block)
      }
      const bytes = Buffer.concat(blocks)
      if (size !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`${item.file}: 摘要或大小不匹配`)
      validateFont(bytes)
      writeFileSync(resolve(directory, item.file), bytes, { flag: 'wx' })
      console.log(`已验证下载：${item.file}`)
    }
  }))
  const failed = results.find(result => result.status === 'rejected')
  if (failed) throw failed.reason
  run(['import', '--source', directory])
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
