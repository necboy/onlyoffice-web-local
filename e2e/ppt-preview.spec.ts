import { test, expect } from '@playwright/test'

test('PPT uses a collapsed left toolbar and continuous pages that adapt to panel size', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 560, height: 1100 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: '新建/打开文件', exact: true }).click()
  await page.locator('[template="PPT"]').click()
  const editor = page.frameLocator('iframe[name="frameEditor"]')
  await expect(editor.locator('.ppt-reading')).toBeVisible({ timeout: 45_000 })
  await expect(editor.locator('canvas[data-rendered="true"]')).toHaveCount(1)
  await expect(editor.locator('#left-menu')).toBeVisible()
  const frame = page.frames().find(frame => frame.name() === 'frameEditor')!
  expect(await frame.evaluate(() => {
    const win = window as any
    return [win.PE.getController('LeftMenu').isThumbsShown,
      win.Common.localStorage.getBool('pe-compact-toolbar'),
      win.Common.localStorage.getBool('pe-hidden-rightmenu')]
  })).toEqual([false, true, true])
  await editor.getByRole('button', { name: '单页 / 编辑', exact: true }).click()
  await expect(editor.locator('.ppt-reading')).toBeHidden()
  // 用真实 SDK 创建额外空白页，验证多页布局与渲染，不依赖私有附件。
  await frame.evaluate(() => {
    const win = window as any
    const api = win.PE.getController('Main').api
    for (let i = 0; i < 5; i++) api.AddSlide()
  })
  await editor.getByRole('button', { name: '连续预览', exact: true }).click()
  await expect(editor.locator('.ppt-reading-page')).toHaveCount(6)
  await expect(editor.locator('.ppt-reading-loading')).toHaveCount(6)
  expect(await editor.locator('.ppt-reading-page[aria-busy="true"]').count()).toBeGreaterThan(0)
  const visiblePages = () => frame.evaluate(() => {
    const root = document.querySelector('.ppt-reading-pages')!.getBoundingClientRect()
    return [...document.querySelectorAll('.ppt-reading-page canvas')].filter(canvas => {
      const box = canvas.getBoundingClientRect()
      return box.top >= root.top && box.bottom <= root.bottom
    }).length
  })
  await expect.poll(visiblePages).toBeGreaterThan(1)
  await page.setViewportSize({ width: 850, height: 650 })
  await expect.poll(visiblePages).toBe(1)
  // 真实滚轮输入必须滚动连续预览，不能被隐藏的 SDK 单页画布接管。
  const scrollTop = () => editor.locator('.ppt-reading-pages').evaluate(element => element.scrollTop)
  await editor.locator('.ppt-reading-page canvas').first().hover()
  await page.mouse.wheel(0, 500)
  await expect.poll(scrollTop).toBeGreaterThan(100)
  const afterDown = await scrollTop()
  await page.mouse.wheel(0, -300)
  await expect.poll(scrollTop).toBeLessThan(afterDown)
  await editor.locator('.ppt-reading-pages').evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(editor.locator('canvas[data-index="5"]')).toHaveAttribute('data-rendered', 'true')
  const lastPage = editor.locator('.ppt-reading-page').nth(5)
  await expect(lastPage.locator('.ppt-reading-loading')).toBeHidden({ timeout: 6000 })
  await expect(lastPage).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => editor.locator('canvas[data-index="0"]').evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBe(1)

  // 模拟 SDK 的晚布局：首次绘制没有内容，也不能永久复用白色位图。
  await frame.evaluate(() => {
    const win = window as any
    const api = win.PE.getController('Main').api
    const model = api.qa.Ba
    const originalDraw = model.eSa
    win.previewPaints = 0
    win.previewReady = false
    model.eSa = (...args: any[]) => {
      if (document.querySelector<HTMLElement>('.ppt-reading')!.hidden) return originalDraw.apply(model, args)
      win.previewPaints++
      if (!win.previewReady) return
      // 测试画布本身；不依赖 SDK 私有 graphics 的 context 字段。
      for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.ppt-reading-page canvas')) {
        if (canvas.width > 1) {
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#eb1234'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
      }
    }
    api.Jc('asc_onDocumentChanged')
  })
  await expect.poll(() => frame.evaluate(() => (window as any).previewPaints)).toBeGreaterThan(0)
  await frame.evaluate(() => { (window as any).previewReady = true })
  const lastPixel = () => editor.locator('canvas[data-index="5"]').evaluate(canvas =>
    Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data))
  await expect.poll(lastPixel).toEqual([235, 18, 52, 255])
  // 补绘有限收敛；之后再来的 SDK 更新仍能使同尺寸缓存失效。
  await page.waitForTimeout(3000)
  const settledPaints = await frame.evaluate(() => (window as any).previewPaints)
  await page.waitForTimeout(300)
  expect(await frame.evaluate(() => (window as any).previewPaints)).toBe(settledPaints)
  await frame.evaluate(() => {
    const win = window as any
    win.PE.getController('Main').api.Jc('asc_onEndAction', 0, 0)
  })
  await expect.poll(() => frame.evaluate(() => (window as any).previewPaints)).toBeGreaterThan(settledPaints)
  const beforeResource = await frame.evaluate(() => (window as any).previewPaints)
  await frame.evaluate(async () => { await (await fetch('/fonts/229?preview-regression=1')).arrayBuffer() })
  await expect.poll(() => frame.evaluate(() => (window as any).previewPaints)).toBeGreaterThan(beforeResource)
  // 已显示的页面在资源更新时保留内容，不重新盖上加载动画。
  await expect(lastPage.locator('.ppt-reading-loading')).toBeHidden()
  await editor.getByRole('button', { name: '单页 / 编辑', exact: true }).click()
  const inactivePaints = await frame.evaluate(() => (window as any).previewPaints)
  await frame.evaluate(() => (window as any).PE.getController('Main').api.Jc('asc_onDocumentChanged'))
  await page.waitForTimeout(300)
  expect(await frame.evaluate(() => (window as any).previewPaints)).toBe(inactivePaints)
  expect(errors).toEqual([])
})

test('nonblank PPT fixture renders pages 11 and 12 directly in continuous preview', async ({ page }) => {
  test.skip(!process.env.PPT_PREVIEW_FIXTURE, 'Set PPT_PREVIEW_FIXTURE to a local regression deck; no private document is checked in.')
  test.setTimeout(120_000)
  await page.route('**/__ppt_preview_fixture.pptx', route => route.fulfill({
    path: process.env.PPT_PREVIEW_FIXTURE!,
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }))
  const fixture = new URL('/__ppt_preview_fixture.pptx', test.info().project.use.baseURL).href
  await page.goto(`/#/?url=${encodeURIComponent(fixture)}&filename=preview.pptx&mode=view`)
  const editor = page.frameLocator('iframe[name="frameEditor"]')
  await expect(editor.locator('.ppt-reading')).toBeVisible({ timeout: 90_000 })
  for (const index of [10, 11]) {
    const canvas = editor.locator(`canvas[data-index="${index}"]`)
    await canvas.scrollIntoViewIfNeeded()
    await expect.poll(() => canvas.evaluate(element => {
      const canvas = element as HTMLCanvasElement
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let marks = 0
      for (let i = 0; i < pixels.length; i += 64) {
        if (pixels[i + 3]! > 0 && Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) < 220) marks++
      }
      return marks
    }), { timeout: 15000 }).toBeGreaterThan(1000)
  }
})
