/** 连续预览复用当前随服务发布的 PPT SDK 渲染器，不另行下载或转换文件。 */
export function setupPptPreview(frame: HTMLIFrameElement, editable = true): () => void {
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
    .ppt-reading-page canvas { display:block; width:100%; background:#fff; box-shadow:0 1px 5px #0003; }
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
  title.textContent = '连续预览 · 滚动查看多页'
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
  let active = true
  const canvases: HTMLCanvasElement[] = []
  const render = (canvas: HTMLCanvasElement) => {
    const width = Math.max(1, pages.clientWidth - 24)
    const height = width * api.get_PresentationHeight() / api.get_PresentationWidth()
    const ratio = Math.min(win.devicePixelRatio || 1, 2)
    if (canvas.width === Math.round(width * ratio) && canvas.dataset.rendered) return
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')!
    const graphics = new win.AscCommon.HA()
    graphics.De(context, canvas.width, canvas.height, api.get_PresentationWidth() / 36000, api.get_PresentationHeight() / 36000)
    graphics.Mq = win.AscCommon.Px
    graphics.transform(1, 0, 0, 1, 0, 0)
    try {
      model.eSa(Number(canvas.dataset.index), graphics)
      canvas.dataset.rendered = 'true'
    } finally {
      context.restore()
    }
  }
  const renderVisible = () => {
    if (disposed || !active) return
    const bounds = pages.getBoundingClientRect()
    for (const canvas of canvases) {
      const rect = canvas.getBoundingClientRect()
      if (rect.bottom >= bounds.top - bounds.height && rect.top <= bounds.bottom + bounds.height) render(canvas)
      else if (canvas.dataset.rendered) {
        // 保留页面占位尺寸，释放远离视口的高分辨率位图。
        canvas.width = canvas.height = 1
        delete canvas.dataset.rendered
      }
    }
  }
  const schedule = () => {
    win.cancelAnimationFrame(raf)
    raf = win.requestAnimationFrame(() => {
      try { renderVisible() } catch (error) {
        console.warn('连续预览渲染失败，恢复单页显示', error)
        setActive(false)
      }
    })
  }
  function setActive(value: boolean) {
    active = value
    root.hidden = !value
    root.style.display = value ? 'flex' : 'none'
    back.hidden = value
    if (value) {
      pages.replaceChildren()
      canvases.length = 0
      for (let index = 0; index < api.getCountPages(); index++) {
        const figure = doc!.createElement('figure')
        figure.className = 'ppt-reading-page'
        const canvas = doc!.createElement('canvas')
        canvas.dataset.index = String(index)
        canvas.style.aspectRatio = `${api.get_PresentationWidth()} / ${api.get_PresentationHeight()}`
        canvas.setAttribute('aria-label', `第 ${index + 1} 张幻灯片`)
        const caption = doc!.createElement('figcaption')
        caption.textContent = `${index + 1} / ${api.getCountPages()}`
        figure.append(canvas, caption)
        figure.ondblclick = () => { setActive(false); api.goToPage(index) }
        pages.append(figure)
        canvases.push(canvas)
      }
      schedule()
    }
  }
  single.onclick = () => setActive(false)
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
  setActive(true)
  return () => {
    disposed = true
    win.cancelAnimationFrame(raf)
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
