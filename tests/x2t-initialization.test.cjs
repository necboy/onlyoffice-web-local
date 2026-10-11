const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/utils/x2t.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
function setup({ early = false, scriptFails = false } = {}) {
    const timers = new Map()
    let id = 0, loads = 0, mkdirs = 0
    const module = { calledRun: early, FS: { mkdir() { mkdirs++ } } }
    const context = {
        require() { return { OFFICE_SCRIPT_TIMEOUT_MS: 180000, OFFICE_RUNTIME_TIMEOUT_MS: 600000 } },
        exports: {}, window: { Module: module }, console,
        setTimeout(fn) { timers.set(++id, fn); return id }, clearTimeout(key) { timers.delete(key) },
        document: { createElement() { return { remove() {} } }, head: { appendChild(script) { loads++; queueMicrotask(() => scriptFails ? script.onerror() : script.onload()) } } },
    }
    vm.createContext(context); vm.runInContext(js, context)
    return { api: context.exports, module, timers, get loads() { return loads }, get mkdirs() { return mkdirs }, allowScript() { scriptFails = false } }
}
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve() }
test('already initialized WASM completes without waiting for a lost event', async () => {
    const s = setup({ early: true })
    await s.api.initX2T()
    assert.equal(s.mkdirs, 4)
    assert.equal(s.timers.size, 0)
})
test('concurrent initialization loads one script and handles the runtime callback', async () => {
    const s = setup()
    const results = Promise.all([s.api.initX2T(), s.api.initX2T()])
    await tick()
    s.module.calledRun = true
    s.module.onRuntimeInitialized()
    await results
    assert.equal(s.loads, 1)
    assert.equal(s.mkdirs, 4)
})
test('runtime timeout clears the rejected promise so retry succeeds', async () => {
    const s = setup()
    const result = assert.rejects(s.api.initX2T(), /initialization timeout/)
    await tick()
    for (const fn of [...s.timers.values()]) fn()
    await result
    s.module.calledRun = true
    await s.api.initX2T()
    assert.equal(s.mkdirs, 4)
})
test('script download failure can be retried', async () => {
    const s = setup({ early: true, scriptFails: true })
    await assert.rejects(s.api.initX2T(), /Failed to load/)
    s.allowScript()
    await s.api.initX2T()
    assert.equal(s.loads, 2)
})
