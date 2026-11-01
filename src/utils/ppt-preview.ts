import { PptPreviewCache } from './ppt-preview-cache'

/** 连续预览复用当前随服务发布的 PPT SDK 渲染器，不另行下载或转换文件。 */
export function setupPptPreview(frame: HTMLIFrameElement, editable = true, onReviewPage?: (index: number) => void, onReviewMode?: (active: boolean, index?: number) => void): () => void {
  const win = frame.contentWindow as any
  const doc = frame.contentDocument
  const api = win?.PE?.getController('Main')?.api
  const host = doc?.getElementById('editor-container')
  if (!doc || !host || !api) return () => {}

  const left = win.PE.getController('LeftMenu')
  left.leftMenu.show()
  left.leftMenu.close()
  left.leftMenu.btnThumbs.toggle(false, true)
  left.isThumbsShown = false
  api.ShowThumbnails(false)
  win.Common.NotificationCenter.trigger('layout:changed', 'main')

  const model = api.qa?.Ba
  if (!model?.eSa || !win.AscCommon?.HA) return () => {}
  const style = doc.createElement('style')
  style.textContent = `
    .ppt-reading { position:absolute; inset:0; z-index:5; background:#e8eaed; display:flex; flex-direction:column; }
    .ppt-reading-bar { flex:none; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; background:#fff; border-bottom:1px solid #ddd; font-size:12px; }
    .ppt-reading-bar button { border:1px solid #ccc; border-radius:4px; background:#fff; padding:4px 8px; cursor:pointer; color:#333; }
    .ppt-reading-pages { overflow:auto; flex:1; min-height:0; padding:12px; overscroll-behavior:contain; }
    .ppt-reading-page { margin:0 0 16px; }
    .ppt-reading-page[role=button] { cursor:pointer; border-radius:3px; outline-offset:3px; }
    .ppt-reading-page[aria-pressed=true], .ppt-reading-page[role=button]:focus-visible { outline:2px solid #2563eb; }
    .ppt-reading-page canvas { display:block; width:100%; background:#fff; box-shadow:0 1px 5px #0003; }
    .ppt-reading-surface { position:relative; }
    .ppt-reading-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:9px; color:#64748b; font-size:13px; background:#f8fafc; pointer-events:none; }
    .ppt-reading-loading[hidden] { display:none; }
    .ppt-reading-spinner { width:18px; height:18px; border:2px solid #dbe5f0; border-top-color:#2563eb; border-radius:50%; animation:ppt-reading-spin .85s linear infinite; animation-play-state:paused; }
    .ppt-reading-page[data-nearby=true] .ppt-reading-spinner { animation-play-state:running; }
    .ppt-reading-page[data-painted=true] .ppt-reading-loading { inset:auto 10px 10px auto; padding:6px 10px; border-radius:16px; background:rgba(248,250,252,.94); font-size:12px; }
    .ppt-reading-page[data-painted=true] .ppt-reading-spinner { width:13px; height:13px; }
    @keyframes ppt-reading-spin { to { transform:rotate(360deg); } }
    @media (prefers-reduced-motion:reduce) { .ppt-reading-spinner { animation:none; } }
    .ppt-reading-page figcaption { text-align:center; font-size:12px; padding-top:5px; color:#555; }
    .ppt-reading-return { position:absolute; top:6px; right:18px; z-index:6; border:1px solid #ccc; border-radius:4px; background:#fff; padding:5px 8px; cursor:pointer; }
  `
  doc.head.append(style)
  const root = doc.createElement('section')
  root.className = 'ppt-reading'
  root.setAttribute('aria-label', '幻灯片连续预览')
  const bar = doc.createElement('div')
  bar.className = 'ppt-reading-bar'
  const title = doc.createElement('span')
  title.textContent = onReviewPage ? '连续预览 · 点击定位页面，双击选择组件' : '连续预览 · 滚动查看多页'
  const single = doc.createElement('button')
  single.textContent = editable ? '单页 / 编辑' : '单页预览'
  bar.append(title, single)
  const pages = doc.createElement('div')
  pages.className = 'ppt-reading-pages'
  root.append(bar, pages)
  const back = doc.createElement('button')
  back.className = 'ppt-reading-return'
  back.textContent = '连续预览'
  back.hidden = true
  host.append(root, back)
  let disposed = false
  let raf = 0
  let retryTimer = 0
  let revision = 0
  let active = true
  let selectedIndex: number | null = null
  const canvases: HTMLCanvasElement[] = []
  const cache = new PptPreviewCache<HTMLCanvasElement>()
  const resetLoading = (canvas: HTMLCanvasElement) => {
    const figure = canvas.closest('figure')!
    delete figure.dataset.painted
    figure.setAttribute('aria-busy', 'true')
    figure.querySelector<HTMLElement>('.ppt-reading-loading')!.hidden = false
  }
  const render = (canvas: HTMLCanvasElement, width: number) => {
    const height = width * api.get_PresentationHeight() / api.get_PresentationWidth()
    const ratio = Math.min(win.devicePixelRatio || 1, 2)
    const pixelWidth = Math.round(width * ratio)
    const pixelHeight = Math.round(height * ratio)
    const key = `${pixelWidth}:${pixelHeight}:${revision}`
    if (!cache.needsPaint(canvas, key, win.performance.now())) return false
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')!
    const graphics = new win.AscCommon.HA()
    graphics.De(context, canvas.width, canvas.height, api.get_PresentationWidth() / 36000, api.get_PresentationHeight() / 36000)
    graphics.Mq = win.AscCommon.Px
    graphics.transform(1, 0, 0, 1, 0, 0)
    try {
      model.eSa(Number(canvas.dataset.index), graphics)
      cache.painted(canvas, key, win.performance.now())
      canvas.dataset.rendered = 'true'
      const figure = canvas.closest('figure')!
      figure.dataset.painted = 'true'
      if (cache.nextRetry(canvas) === undefined) {
        figure.querySelector<HTMLElement>('.ppt-reading-loading')!.hidden = true
        figure.setAttribute('aria-busy', 'false')
      }
    } finally {
      context.restore()
    }
    return true
  }
  const renderVisible = () => {
    win.clearTimeout(retryTimer)
    retryTimer = 0
    if (disposed || !active || doc.hidden) return
    const bounds = pages.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    // 先统一读取布局，再绘图；当前视口优先，随后预绘前后各一个视口。
    const nearby: { canvas: HTMLCanvasElement; visible: boolean; width: number }[] = []
    for (const canvas of canvases) {
      const rect = canvas.getBoundingClientRect()
      const figure = canvas.closest('figure')!
      figure.dataset.nearby = String(rect.bottom >= bounds.top - bounds.height && rect.top <= bounds.bottom + bounds.height)
      if (rect.bottom >= bounds.top - bounds.height && rect.top <= bounds.bottom + bounds.height) {
        if (rect.width > 0) nearby.push({ canvas, visible: rect.bottom >= bounds.top && rect.top <= bounds.bottom, width: rect.width })
      } else if (canvas.dataset.rendered) {
        // 保留页面占位尺寸，释放远离视口的高分辨率位图。
        canvas.width = canvas.height = 1
        delete canvas.dataset.rendered
        cache.release(canvas)
        resetLoading(canvas)
      }
    }
    nearby.sort((a, b) => Number(b.visible) - Number(a.visible))
    let painted = 0
    const started = win.performance.now()
    let retryAt = Infinity
    let more = false
    for (const { canvas, width } of nearby) {
      // 一帧最多绘制两页，避免长文档/慢设备阻塞滚动与 SDK 的异步布局。
      if (painted > 0 && (painted >= 2 || win.performance.now() - started >= 12)) { more = true; break }
      if (render(canvas, width)) painted++
      retryAt = Math.min(retryAt, cache.nextRetry(canvas) ?? Infinity)
    }
    if (more) schedule()
    else if (Number.isFinite(retryAt)) retryTimer = win.setTimeout(schedule, Math.max(1, retryAt - win.performance.now()))
  }
  const schedule = () => {
    if (disposed || !active || doc.hidden || raf) return
    raf = win.requestAnimationFrame(() => {
      raf = 0
      try { renderVisible() } catch (error) {
        console.warn('连续预览渲染失败，恢复单页显示', error)
        setActive(false)
      }
    })
  }
  function setActive(value: boolean) {
    win.cancelAnimationFrame(raf)
    raf = 0
    win.clearTimeout(retryTimer)
    retryTimer = 0
    active = value
    root.hidden = !value
    root.style.display = value ? 'flex' : 'none'
    back.hidden = value
    if (!value) {
      for (const canvas of canvases) {
        canvas.width = canvas.height = 1
        delete canvas.dataset.rendered
      }
      cache.clear()
    }
    if (value) {
      selectedIndex = api.getCurrentPage()
      pages.replaceChildren()
      canvases.length = 0
      cache.clear()
      for (let index = 0; index < api.getCountPages(); index++) {
        const figure = doc!.createElement('figure')
        figure.className = 'ppt-reading-page'
        figure.setAttribute('aria-busy', 'true')
        const surface = doc!.createElement('div')
        surface.className = 'ppt-reading-surface'
        const canvas = doc!.createElement('canvas')
        canvas.dataset.index = String(index)
        canvas.style.aspectRatio = `${api.get_PresentationWidth()} / ${api.get_PresentationHeight()}`
        canvas.setAttribute('aria-label', `第 ${index + 1} 张幻灯片`)
        const loading = doc!.createElement('div')
        loading.className = 'ppt-reading-loading'
        // aria-busy 由页面承载，避免多页动画同时触发读屏播报。
        loading.setAttribute('aria-hidden', 'true')
        const spinner = doc!.createElement('span')
        spinner.className = 'ppt-reading-spinner'
        const loadingText = doc!.createElement('span')
        loadingText.textContent = '正在渲染…'
        loading.append(spinner, loadingText)
        const caption = doc!.createElement('figcaption')
        caption.textContent = `${index + 1} / ${api.getCountPages()}`
        surface.append(canvas, loading)
        figure.append(surface, caption)
        figure.onclick = () => {
          if (onReviewPage) {
            for (const item of pages.querySelectorAll('.ppt-reading-page[role=button]')) item.setAttribute('aria-pressed', item === figure ? 'true' : 'false')
            selectedIndex = index
            onReviewPage(index)
          }
        }
        figure.ondblclick = () => { setActive(false); api.goToPage(index) }
        if (onReviewPage) {
          figure.tabIndex = 0
          figure.setAttribute('aria-pressed', selectedIndex === index ? 'true' : 'false')
          figure.setAttribute('role', 'button')
          figure.setAttribute('aria-label', `选择第 ${index + 1} 页，双击或按回车进入单页选择组件`)
          figure.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); setActive(false); api.goToPage(index) } }
        }
        pages.append(figure)
        canvases.push(canvas)
      }
      schedule()
    }
    onReviewMode?.(value, value ? selectedIndex ?? undefined : undefined)
  }
  single.onclick = () => {
    const index = selectedIndex ?? api.getCurrentPage()
    setActive(false)
    api.goToPage(index)
  }
  back.onclick = () => setActive(true)
  // 编辑、查找或缩略图跳转时回到原生单页界面，避免操作被预览遮挡。
  const onTools = (event: Event) => {
    if (active && event.target instanceof win.Node && !host.contains(event.target as Node)) setActive(false)
  }
  doc.addEventListener('pointerdown', onTools)
  // SDK 的 viewport/body 会取消默认滚动；预览先接管事件，避免传到单页画布。
  const onWheel = (event: WheelEvent) => {
    if (!active || disposed) return
    event.stopPropagation()
    if (event.ctrlKey || event.metaKey) return // 保留浏览器缩放手势。
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pages.clientHeight : 1
    pages.scrollTop += event.deltaY * unit
    pages.scrollLeft += event.deltaX * unit
  }
  const onLegacyWheel = (event: Event) => {
    if (active && !disposed) event.stopPropagation()
  }
  root.addEventListener('wheel', onWheel, { capture: true, passive: false })
  root.addEventListener('mousewheel', onLegacyWheel, { capture: true, passive: true })
  root.addEventListener('DOMMouseScroll', onLegacyWheel, { capture: true, passive: true })
  pages.addEventListener('scroll', schedule, { passive: true })
  const observer = new win.ResizeObserver(schedule)
  observer.observe(pages)
  // SDK 的逐页重算会触发 DocumentChanged；字体/图片动作结束后也必须失效旧位图。
  const invalidate = () => { revision++; schedule() }
  const sdkEvents = ['asc_onDocumentChanged', 'asc_onEndAction']
  for (const event of sdkEvents) api.asc_registerCallback?.(event, invalidate)
  const onVisibility = () => {
    if (doc.hidden) {
      win.cancelAnimationFrame(raf)
      raf = 0
      win.clearTimeout(retryTimer)
      retryTimer = 0
    } else invalidate()
  }
  doc.addEventListener('visibilitychange', onVisibility)
  doc.fonts?.addEventListener('loadingdone', invalidate)
  // SDK 二进制字体通过 XHR 加载，不属于 document.fonts；只观察本编辑器的资源完成。
  let resources: PerformanceObserver | undefined
  if (win.PerformanceObserver) {
    try {
      resources = new win.PerformanceObserver((list: PerformanceObserverEntryList) => {
        if (list.getEntries().some(entry => /\/fonts\/|\.(?:ttf|ttc|otf|png|jpe?g|svg|webp)(?:[?#]|$)/i.test(entry.name))) invalidate()
      })
      resources!.observe({ entryTypes: ['resource'] })
    } catch { resources?.disconnect() }
  }
  setActive(true)
  return () => {
    disposed = true
    win.cancelAnimationFrame(raf)
    win.clearTimeout(retryTimer)
    cache.clear()
    for (const event of sdkEvents) api.asc_unregisterCallback?.(event, invalidate)
    resources?.disconnect()
    doc.fonts?.removeEventListener('loadingdone', invalidate)
    doc.removeEventListener('visibilitychange', onVisibility)
    observer.disconnect()
    doc.removeEventListener('pointerdown', onTools)
    root.removeEventListener('wheel', onWheel, true)
    root.removeEventListener('mousewheel', onLegacyWheel, true)
    root.removeEventListener('DOMMouseScroll', onLegacyWheel, true)
    pages.removeEventListener('scroll', schedule)
    root.remove()
    back.remove()
    style.remove()
  }
}
