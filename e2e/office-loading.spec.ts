import { test, expect } from '@playwright/test'

const apiStub = `window.DocsAPI = { DocEditor: function(id, config) {
  window.__officeConfig = config;
  const timer = setTimeout(() => config.events.onDocumentReady(), 1200);
  return { destroyEditor() { clearTimeout(timer); }, sendCommand() {} };
} };`

test.beforeEach(async ({ page }) => {
  // Execute the real converter initialization with a WASM runtime that is already ready.
  await page.route('**/wasm/x2t/x2t.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Module = { calledRun: true, FS: { mkdir() {} } };`,
  }))
})

test('fast WASM and delayed editor API initialize successfully and keep loading until ready', async ({ page }) => {
  await page.route('**/api/documents/api.js*', async route => {
    await new Promise(resolve => setTimeout(resolve, 800))
    await route.fulfill({ contentType: 'application/javascript', body: apiStub })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '新建/打开文件', exact: true }).click()
  await page.locator('[template="WORD"]').click()
  await expect(page.getByText('正在加载文档预览组件，首次打开或网速较慢时可能需要几分钟…')).toBeVisible()
  await expect.poll(() => page.evaluate(() => !!(window as any).__officeConfig)).toBe(true)
  await expect(page.getByText('正在打开文档…')).toBeVisible()
  await expect(page.getByText('正在打开文档…')).toBeHidden()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('failed editor API shows an error and retry recovers in the same page', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/documents/api.js*', route => {
    attempts++
    return attempts === 1 ? route.abort() : route.fulfill({ contentType: 'application/javascript', body: apiStub })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '新建/打开文件', exact: true }).click()
  await page.locator('[template="WORD"]').click()
  await expect(page.getByRole('alert')).toContainText('文档打开失败')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!(window as any).__officeConfig)).toBe(true)
  await expect(page.getByText('正在打开文档…')).toBeHidden()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(attempts).toBe(2)
})

test('URL download progress stays visible until the document is actually ready', async ({ page }) => {
  await page.route(/\/src\/utils\/x2t\.ts(?:\?.*)?$/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const initX2T = async () => {};
      export const convertDocument = async () => ({ bin: new Uint8Array([1]), media: {} });
      export const convertBinOnly = async () => {};
      export const convertBinToDocumentAndDownload = async () => {};
      export const c_oAscFileType2 = {};`,
  }))
  await page.route('https://fixtures.example.test/contract.docx', route => route.fulfill({
    body: 'fixture', headers: { 'Access-Control-Allow-Origin': '*' },
  }))
  await page.route('**/api/documents/api.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: apiStub.replace('1200', '2500'),
  }))
  await page.goto('/#/?url=https%3A%2F%2Ffixtures.example.test%2Fcontract.docx&filename=contract.docx')
  await expect.poll(() => page.evaluate(() => !!(window as any).__officeConfig)).toBe(true)
  await expect(page.locator('.loading-overlay')).toBeVisible()
  // The old 700ms timer would hide this before the real document-ready event.
  await page.waitForTimeout(1000)
  await expect(page.locator('.loading-overlay')).toBeVisible()
  await expect(page.locator('.loading-overlay')).toBeHidden()
})

test('WASM can initialize after the old 30 second limit while showing a clear status', async ({ page }) => {
  await page.clock.install()
  await page.route('**/wasm/x2t/x2t.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.Module = { calledRun: false, FS: { mkdir() {} } };
      setTimeout(() => { Module.calledRun = true; Module.onRuntimeInitialized?.(); }, 61000);`,
  }))
  await page.route('**/api/documents/api.js*', route => route.fulfill({
    contentType: 'application/javascript', body: apiStub,
  }))
  await page.goto('/')
  await page.getByRole('button', { name: '新建/打开文件', exact: true }).click()
  await page.locator('[template="WORD"]').click()
  const status = page.getByText('正在加载文档预览组件，首次打开或网速较慢时可能需要几分钟…')
  await expect(status).toBeVisible()
  // Ensure the WASM script has run before advancing its delayed initialization.
  await expect.poll(() => page.evaluate(() => !!(window as any).Module?.onRuntimeInitialized)).toBe(true)
  await page.clock.fastForward(31000)
  await expect(status).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.clock.fastForward(31000)
  await expect.poll(() => page.evaluate(() => !!(window as any).__officeConfig)).toBe(true)
  await page.clock.fastForward(2000)
  await expect(status).toBeHidden()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('startup status is visible before the application JavaScript downloads', async ({ page }) => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  await page.route('**/src/main.ts', async route => {
    await blocked
    await route.continue()
  })
  await page.goto('/', { waitUntil: 'commit' })
  await expect(page.getByRole('status')).toContainText('正在加载文档预览')
  await expect(page.getByText('首次打开或网速较慢时可能需要几分钟，请稍候。')).toBeVisible()
  release()
  await expect(page.getByRole('button', { name: '新建/打开文件', exact: true })).toBeVisible()
  await expect(page.locator('.office-startup')).toHaveCount(0)
})

test('WASM initializes while the attachment download is still pending', async ({ page }) => {
  let release!: () => void
  const pendingDownload = new Promise<void>(resolve => { release = resolve })
  await page.route('https://fixtures.example.test/slow.docx', async route => {
    await pendingDownload
    await route.abort()
  })
  await page.goto('/#/?url=https%3A%2F%2Ffixtures.example.test%2Fslow.docx&filename=slow.docx')
  try {
    await expect(page.locator('.loading-overlay')).toBeVisible()
    await expect.poll(() => page.evaluate(() => !!(window as any).Module?.calledRun)).toBe(true)
    expect(await page.evaluate(() => !!(window as any).__officeConfig)).toBe(false)
  } finally {
    release()
  }
  await expect(page.getByRole('alert')).toContainText('文件加载失败')
})
