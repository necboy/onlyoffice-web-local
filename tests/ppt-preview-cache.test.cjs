const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/utils/ppt-preview-cache.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
const context = { exports: {} }
vm.runInNewContext(js, context)
const { PptPreviewCache } = context.exports

test('a successful first paint still gets bounded settling retries without scroll', () => {
  const cache = new PptPreviewCache(), canvas = {}
  assert.equal(cache.needsPaint(canvas, '100:60:0', 0), true)
  cache.painted(canvas, '100:60:0', 0)
  for (const at of [200, 800, 2400]) {
    assert.equal(cache.needsPaint(canvas, '100:60:0', at - 1), false)
    assert.equal(cache.needsPaint(canvas, '100:60:0', at), true)
    cache.painted(canvas, '100:60:0', at)
  }
  assert.equal(cache.nextRetry(canvas), undefined)
  assert.equal(cache.needsPaint(canvas, '100:60:0', 60000), false)
})

test('late SDK/resource revision invalidates a settled bitmap at the same dimensions', () => {
  const cache = new PptPreviewCache(), canvas = {}
  for (const at of [0, 200, 800, 2400]) cache.painted(canvas, '100:60:0', at)
  assert.equal(cache.needsPaint(canvas, '100:60:0', 30000), false)
  assert.equal(cache.needsPaint(canvas, '100:60:1', 30000), true)
  cache.painted(canvas, '100:60:1', 30000)
  assert.equal(cache.nextRetry(canvas), 30200)
})

test('height and pixel ratio changes invalidate even if the CSS width is unchanged', () => {
  const cache = new PptPreviewCache(), canvas = {}
  cache.painted(canvas, '100:60:0', 0)
  assert.equal(cache.needsPaint(canvas, '100:80:0', 1), true)
  assert.equal(cache.needsPaint(canvas, '200:120:0', 1), true)
})

test('eviction, mode changes and disposal cannot reuse a released bitmap', () => {
  const cache = new PptPreviewCache(), first = {}, second = {}
  cache.painted(first, '100:60:0', 0)
  cache.painted(second, '100:60:0', 0)
  cache.release(first)
  assert.equal(cache.nextRetry(first), undefined)
  assert.equal(cache.needsPaint(first, '100:60:0', 1), true)
  assert.equal(cache.needsPaint(second, '100:60:0', 1), false)
  cache.clear()
  assert.equal(cache.needsPaint(second, '100:60:0', 1), true)
})
