import { readFileSync, readdirSync, lstatSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const root = fileURLToPath(new URL('../', import.meta.url))
const key = Buffer.from([160, 102, 214, 32, 20, 150, 71, 250, 149, 105, 184, 80, 176, 65, 73, 72])
// SDK 对网络字体的前 32 字节执行同一 XOR；不可直接复制原始 TTF/TTC。
export function transformFont(bytes) {
  const result = Buffer.from(bytes)
  for (let i = 0; i < Math.min(32, result.length); i++) result[i] ^= key[i % key.length]
  return result
}

export function validateFont(bytes) {
  function face(offset) {
    if (offset + 12 > bytes.length) throw new Error('字体头不完整')
    const signature = bytes.subarray(offset, offset + 4).toString('hex')
    if (!['00010000', '4f54544f', '74727565'].includes(signature)) throw new Error('不支持的 SFNT 字体格式')
    const count = bytes.readUInt16BE(offset + 4)
    if (!count || offset + 12 + count * 16 > bytes.length) throw new Error('字体表目录不完整')
    for (let i = 0; i < count; i++) {
      const entry = offset + 12 + i * 16
      if (bytes.readUInt32BE(entry + 8) + bytes.readUInt32BE(entry + 12) > bytes.length) throw new Error('字体表越界')
    }
  }
  if (bytes.length < 12) throw new Error('字体文件过短')
  if (bytes.subarray(0, 4).toString() === 'ttcf') {
    const count = bytes.readUInt32BE(8)
    if (!count || count > 1024 || 12 + count * 4 > bytes.length) throw new Error('TTC 目录无效')
    for (let i = 0; i < count; i++) face(bytes.readUInt32BE(12 + i * 4))
  } else face(0)
}

export function fontIndex() {
  const text = readFileSync(resolve(root, 'public/sdkjs/common/AllFonts.js'), 'utf8')
  const match = text.match(/window\.__fonts_files\s*=\s*(\[[^;]*?\])/)
  if (!match) throw new Error('无法读取 AllFonts.js 字体索引')
  return JSON.parse(match[1]).map((name, index) => ({
    name: name.split(/[\\/]/).at(-1), id: String(index).padStart(3, '0'),
  }))
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function regularFile(path) {
  if (!lstatSync(path).isFile()) throw new Error(`仅允许常规字体文件：${path}`)
  return readFileSync(path)
}
function atomicWrite(path, bytes) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, bytes, { flag: 'wx' })
  renameSync(temporary, path)
}

export function run(args) {
  const [command, ...options] = args
  const index = fontIndex()
  const dir = resolve(root, 'public/fonts')
  const manifestPath = resolve(root, 'config/font-resources.json')
  const policy = JSON.parse(readFileSync(resolve(root, 'config/fonts.json'), 'utf8'))
  if (command === 'import') {
    if (options.length !== 2 || options[0] !== '--source') throw new Error('用法：node scripts/fonts.mjs import --source <字体目录>')
    const source = resolve(options[1])
    const candidates = new Map()
    for (const name of readdirSync(source)) {
      const lower = name.toLowerCase()
      if (candidates.has(lower)) throw new Error(`源目录存在大小写冲突：${name}`)
      candidates.set(lower, name)
    }
    const existing = new Set(readdirSync(dir))
    let count = 0
    for (const { name, id } of index) {
      if (existing.has(id) || !candidates.has(name.toLowerCase())) continue
      const bytes = regularFile(resolve(source, candidates.get(name.toLowerCase())))
      validateFont(bytes)
      atomicWrite(resolve(dir, id), transformFont(bytes))
      console.log(`导入 ${id}: ${name}`)
      count++
    }
    // 完整快照也覆盖原有字体；不记录本机绝对路径。
    const bundled = new Set(readdirSync(dir))
    const resources = index.filter(({ id }) => bundled.has(id)).map(({ id, name }) => {
      const bytes = regularFile(resolve(dir, id))
      validateFont(transformFont(bytes))
      return { id, name, bytes: bytes.length, sha256: digest(bytes) }
    })
    atomicWrite(manifestPath, JSON.stringify({ version: 1, resources }, null, 2) + '\n')
    console.log(`新增 ${count} 个字体，资源清单共 ${resources.length} 项。`)
  } else if (command !== 'check' || options.length) {
    throw new Error('用法：node scripts/fonts.mjs check | import --source <字体目录>')
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const byId = new Map(index.map(item => [item.id, item.name]))
  const ids = new Set()
  for (const item of manifest.resources) {
    if (!/^\d{3}$/.test(item.id) || ids.has(item.id) || byId.get(item.id) !== item.name) throw new Error(`字体清单与 SDK 索引不匹配：${item.id}`)
    ids.add(item.id)
    const bytes = regularFile(resolve(dir, item.id))
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw new Error(`字体摘要或大小不匹配：${item.id}`)
    validateFont(transformFont(bytes))
  }
  for (const name of policy.required) {
    const item = index.find(item => item.name.toLowerCase() === name.toLowerCase())
    if (!item || !ids.has(item.id)) throw new Error(`缺少必需字体：${name}`)
  }
  const missing = policy.optional.filter(name => !index.some(item => item.name.toLowerCase() === name.toLowerCase() && ids.has(item.id)))
  console.log(`字体校验通过：${ids.size} 个资源；常用必需字体齐全。`)
  if (missing.length) console.log(`可选英文字体尚未导入：${missing.join(', ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
