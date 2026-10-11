import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // 隔离 WASM 转换，验证 URL 参数到实际 DocsAPI 配置和保存回调的链路。
  await page.route(/\/src\/utils\/x2t\.ts(?:\?.*)?$/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export const initX2TScript = async () => {};
      export const initX2T = async () => {};
      export const convertDocument = async () => ({ bin: new Uint8Array([1]), media: {} });
      export const convertBinOnly = async () => ({ fileName: 'contract.docx', data: new Uint8Array([1]) });
      export const convertBinToDocumentAndDownload = async () => {};
      export const c_oAscFileType2 = { 1: 'DOCX' };
    `,
  }))
  await page.route('https://fixtures.example.test/contract.docx', route => route.fulfill({
    body: 'document fixture', headers: { 'Access-Control-Allow-Origin': '*' },
  }))
  await page.addInitScript(() => {
    const state = window as any
    state.__saveCommands = []
    state.DocsAPI = {
      DocEditor: function (_id: string, config: any) {
        state.__officeConfig = config
        return {
          destroyEditor() {},
          sendCommand(command: any) { state.__saveCommands.push(command) },
        }
      },
    }
  })
})

for (const query of ['&mode=view', '&mode=view&saveurl=https%3A%2F%2Ffixtures.example.test%2Fsave']) {
  test(`keeps remote preview read-only for ${query || 'default mode'}`, async ({ page }) => {
    await page.goto(`/#/?url=https%3A%2F%2Ffixtures.example.test%2Fcontract.docx&filename=contract.docx${query}`)
    await expect.poll(() => page.evaluate(() => (window as any).__officeConfig?.editorConfig.mode)).toBe('view')
    expect(await page.evaluate(() => (window as any).__officeConfig.document.permissions.edit)).toBe(false)
    await page.evaluate(() => (window as any).__officeConfig.events.onSave({ data: { data: { data: [1] }, option: { outputformat: 1 } } }))
    expect(await page.evaluate(() => (window as any).__saveCommands.at(-1).data.err_code)).toBe(1)
  })
}

test('opens remote documents in edit mode by default and distinguishes local export from server save', async ({ page }) => {
  await page.goto('/#/?url=https%3A%2F%2Ffixtures.example.test%2Fcontract.docx&filename=contract.docx')
  await expect.poll(() => page.evaluate(() => (window as any).__officeConfig?.editorConfig.mode)).toBe('edit')
  expect(await page.evaluate(() => (window as any).__officeConfig.document.permissions.edit)).toBe(true)
  await page.evaluate(() => (window as any).__officeConfig.events.onSave({ data: { data: { data: [1] }, option: { outputformat: 1 } } }))
  expect(await page.evaluate(() => (window as any).__saveCommands.at(-1).data.err_code)).toBe(0)
  await expect(page.getByText('文件已导出到本地，未回写服务器')).toBeVisible()
})

test('enables explicit editable mode with a save URL and reports server save failure', async ({ page }) => {
  await page.route('https://fixtures.example.test/save', route => route.fulfill({
    status: 403, body: 'Forbidden', headers: { 'Access-Control-Allow-Origin': '*' },
  }))
  await page.goto('/#/?url=https%3A%2F%2Ffixtures.example.test%2Fcontract.docx&filename=contract.docx&mode=edit&saveurl=https%3A%2F%2Ffixtures.example.test%2Fsave')
  await expect.poll(() => page.evaluate(() => (window as any).__officeConfig?.editorConfig.mode)).toBe('edit')
  expect(await page.evaluate(() => (window as any).__officeConfig.document.permissions.edit)).toBe(true)
  await page.evaluate(() => (window as any).__officeConfig.events.onSave({ data: { data: { data: [1] }, option: { outputformat: 1 } } }))
  expect(await page.evaluate(() => (window as any).__saveCommands.at(-1).data.err_code)).toBe(1)
  await expect(page.getByText('保存失败：服务器响应 403')).toBeVisible()
})

test('editable workspace copies post file bytes and acknowledge a successful server save', async ({ page }) => {
  let saved = false
  await page.route('https://fixtures.example.test/save', async route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['content-type']).toContain('multipart/form-data')
    expect(route.request().postDataBuffer()?.toString()).toContain('filename="contract.docx"')
    saved = true
    await route.fulfill({ body: '{"success":true}', headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.goto('/#/?url=https%3A%2F%2Ffixtures.example.test%2Fcontract.docx&filename=contract.docx&mode=edit&saveurl=https%3A%2F%2Ffixtures.example.test%2Fsave')
  await expect.poll(() => page.evaluate(() => !!(window as any).__officeConfig)).toBe(true)
  await page.evaluate(() => (window as any).__officeConfig.events.onSave({ data: { data: { data: [1] }, option: { outputformat: 1 } } }))
  expect(saved).toBe(true)
  expect(await page.evaluate(() => (window as any).__saveCommands.at(-1).data.err_code)).toBe(0)
  await expect(page.getByText('文件已保存', { exact: true })).toBeVisible()
  await expect(page.getByText('文件已导出到本地，未回写服务器')).toBeHidden()
})
