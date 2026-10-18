const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/utils/office-review.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
function setup() {
  const messages = [], listeners = {}, pointerListeners = {}, callbacks = {}, timers = new Map()
  let timerId = 0, now = 0
  const top = { postMessage(data, origin) { messages.push({data,origin}) } }
  const context = { exports: {}, URL, window: { top, innerWidth: 1000, innerHeight: 800, addEventListener(name, fn) { listeners[name] = fn }, removeEventListener(name) { delete listeners[name] } }, setTimeout(fn, delay = 0) { timers.set(++timerId, { fn, at: now + delay }); return timerId }, clearTimeout(id) { timers.delete(id) } }
  vm.runInNewContext(js, context)
  const types = { Shape: 1, Image: 2, Table: 3, Chart: 4 }
  const api = { getCurrentPage() { return 2 }, getSelectedElements() { return [] }, asc_registerCallback(name, fn) { callbacks[name] = fn }, asc_unregisterCallback(name) { delete callbacks[name] } }
  const frame = { getBoundingClientRect: () => ({left: 20, top: 40, width: 800, height: 600}), contentDocument: { addEventListener(name, fn) {pointerListeners[name] = fn}, removeEventListener(name) {delete pointerListeners[name]} }, contentWindow: { innerWidth: 800, innerHeight: 600, PE: { getController() { return {api} } }, Asc: { c_oAscTypeSelectElement: types } } }
  const binding = { id: '0123456789abcdef', documentKey: 'local-test', origin: 'http://localhost:3000' }
  const emit = data => listeners.message({ source: top, origin: binding.origin, data: { id: binding.id, ...data } })
  const tick = () => { const batch = [...timers]; timers.clear(); batch.forEach(([,timer]) => timer.fn()) }
  const advance = ms => {
    const end = now + ms
    for (let n = 0; n < 100; n++) {
      const next = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at; timers.delete(next[0]); next[1].fn()
    }
    now = end
  }
  return { advance, exports: context.exports, frame, api, types, binding, emit, tick, messages, listeners, pointerListeners, callbacks, top }
}
test('binding requires a bounded identity and an exact HTTP(S) origin', () => {
  const s = setup(), parse = s.exports.parseReviewBinding
  assert.equal(parse('short', 'key', 'https://host.test'), undefined)
  assert.equal(parse(s.binding.id, 'key', 'javascript:alert(1)'), undefined)
  assert.equal(parse(s.binding.id, 'key', 'https://host.test/path'), undefined)
  assert.equal(parse(s.binding.id, 'key', 'https://user:password@host.test'), undefined)
  assert.equal(parse(s.binding.id, 'key', 'https://host.test').origin, 'https://host.test')
})
test('native public getters capture one component and explicitly tag millimeter geometry', () => {
  const s = setup()
  s.api.getSelectedElements = () => [{ get_ObjectType: () => 1, get_ObjectValue: () => ({ get_Name: () => 'Title', get_Position: () => ({get_X: () => 10, get_Y: () => 20}), get_Width: () => 100, get_Height: () => 30 }) }]
  const result = s.exports.readPresentationReview(s.api,s.types)
  assert.equal(result.page,3)
  assert.equal(result.kind,'object')
  assert.equal(result.name,'Title')
  assert.equal(result.boundsUnit,'mm')
  assert.equal(result.bounds.width,100)
})
test('multiple selection does not masquerade as a single component', () => {
  const s = setup()
  s.api.getSelectedElements = () => [{get_ObjectType: () => 1},{get_ObjectType: () => 2}]
  assert.equal(s.exports.readPresentationReview(s.api,s.types).kind,'slide')
})
test('subscriptions authenticate the parent, follow native selection, and are disposed cleanly', () => {
  const s = setup(), bridge = s.exports.setupOfficeReview(s.frame,s.binding)
  s.listeners.message({ source: {}, origin: s.binding.origin, data: { id:s.binding.id, type:'mantis-office-review-watch',watchId:'bad',enabled:true } })
  s.callbacks.asc_onFocusObject()
  assert.equal(s.messages.length,1)
  s.emit({type:'mantis-office-review-watch',watchId:'watch',enabled:true})
  s.tick()
  assert.equal(s.messages.at(-1).data.target.page,3)
  assert.equal(s.messages.at(-1).origin,s.binding.origin)
  bridge.selectPage(7);s.tick()
  assert.equal(s.messages.at(-1).data.target.page,8)
  assert.equal(s.messages.at(-1).data.target.kind,'slide')
  s.emit({type:'mantis-office-review-watch',watchId:'watch',enabled:false})
  const count = s.messages.length
  s.callbacks.asc_onCurrentPage();s.tick()
  assert.equal(s.messages.length,count)
  bridge.dispose()
  assert.equal(Object.keys(s.listeners).length,0)
  assert.equal(Object.keys(s.callbacks).length,0)
})

test('native pointer hints are viewport-only, disabled without a subscription, and removed on dispose', () => {
  const s = setup(), bridge = s.exports.setupOfficeReview(s.frame,s.binding)
  const click = () => s.pointerListeners.pointerup({button:0,isPrimary:true,clientX:400,clientY:200})
  click();s.tick()
  assert.equal(s.messages.filter(m=>m.data.anchor).length,0)
  s.emit({type:'mantis-office-review-watch',watchId:'watch',enabled:true})
  click();s.tick()
  assert.equal(s.messages.at(-1).data.anchor.x,42)
  assert.equal(s.messages.at(-1).data.anchor.y,30)
  assert.equal(s.messages.at(-1).data.target.anchor,undefined)
  bridge.selectPage(1);s.tick()
  assert.equal(s.messages.at(-1).data.anchor,null)
  bridge.dispose()
  assert.equal(Object.keys(s.pointerListeners).length,0)
})

test('synchronous focus callbacks emitted by getters cannot invalidate their own snapshot', () => {
  const s = setup(), bridge = s.exports.setupOfficeReview(s.frame,s.binding)
  s.api.getSelectedElements = () => {
    s.callbacks.asc_onFocusObject()
    return [{ get_ObjectType: () => 1, get_ObjectValue: () => ({ get_Name: () => 'Title' }) }]
  }
  s.emit({ type:'mantis-office-review-watch', watchId:'watch', enabled:true })
  s.advance(150)
  assert.equal(s.messages.at(-1).data.pending, false)
  assert.equal(s.messages.at(-1).data.target.name, 'Title')
  const count = s.messages.length
  for (let i = 0; i < 20; i++) { s.callbacks.asc_onFocusObject(); s.advance(20) }
  assert.equal(s.messages.length, count, 'identical selection must not flicker through pending')
  bridge.dispose()
})
test('continuous genuine changes cannot postpone the read deadline', () => {
  const s = setup(), bridge = s.exports.setupOfficeReview(s.frame,s.binding)
  let page = 0
  s.api.getCurrentPage = () => page
  s.emit({ type:'mantis-office-review-watch', watchId:'watch', enabled:true })
  for (let i = 0; i < 12; i++) { s.advance(50); page++; s.callbacks.asc_onCurrentPage() }
  const results = s.messages.filter(m => m.data.type === 'mantis-office-review-selection' && m.data.pending === false)
  assert.ok(results.length >= 3)
  s.advance(150)
  assert.equal(s.messages.at(-1).data.target.page, 13)
  bridge.dispose()
})
test('continuous preview selection survives SDK layout events and switches back to native objects explicitly', () => {
  const s = setup(), bridge = s.exports.setupOfficeReview(s.frame,s.binding)
  s.api.getSelectedElements = () => [{ get_ObjectType: () => 1, get_ObjectValue: () => ({ get_Name: () => 'Selected title' }) }]
  bridge.setPreviewMode(true, 7)
  s.emit({ type:'mantis-office-review-watch', watchId:'watch', enabled:true }); s.advance(150)
  const count = s.messages.length
  for (let i = 0; i < 10; i++) { s.callbacks.asc_onCurrentPage(); s.callbacks.asc_onFocusObject(); bridge.selectPage(7); s.advance(20) }
  assert.equal(s.messages.length, count)
  assert.equal(s.messages.at(-1).data.target.page, 8)
  assert.equal(s.messages.at(-1).data.target.kind, 'slide')
  bridge.setPreviewMode(false); s.advance(150)
  assert.equal(s.messages.at(-1).data.target.page, 3)
  assert.equal(s.messages.at(-1).data.target.name, 'Selected title')
  bridge.dispose()
})
