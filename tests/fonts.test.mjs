import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformFont, validateFont, fontIndex, root, run } from '../scripts/fonts.mjs'

test('SDK network encoding decodes bundled fonts to SFNT/TTC', () => {
  for (const id of ['070', '223', '319', '287', '288']) {
    const encoded = readFileSync(resolve(root, 'public/fonts', id))
    const decoded = transformFont(encoded)
    validateFont(decoded)
    assert.deepEqual(transformFont(decoded), encoded)
    assert.deepEqual(decoded.subarray(32), encoded.subarray(32))
  }
})

test('reject HTML responses, truncated and out-of-bounds fonts', () => {
  assert.throws(() => validateFont(Buffer.from('<html>404 Not Found</html>')))
  const bytes = Buffer.alloc(28)
  bytes.writeUInt32BE(0x00010000)
  bytes.writeUInt16BE(1, 4)
  bytes.writeUInt32BE(100, 20)
  bytes.writeUInt32BE(10, 24)
  assert.throws(() => validateFont(bytes), /越界/)
  assert.throws(() => validateFont(Buffer.from('ttcf')))
})

test('font bundle manifest matches SDK indices and required fonts', () => {
  const index = fontIndex()
  assert.equal(index.find(item => item.id === '287').name, 'msyh.ttc')
  assert.equal(index.find(item => item.id === '288').name, 'msyhbd.ttc')
  run(['check'])
})
