import { test, expect } from '@playwright/test'

test('PPT uses a collapsed left toolbar and continuous pages that adapt to panel size', async ({ page }) => {
  test.setTimeout(60_000)
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
  expect(errors).toEqual([])
})
