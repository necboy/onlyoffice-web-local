import { test, expect } from '@playwright/test'

for (const documentType of ['WORD', 'EXCEL', 'PPT']) {
  for (const mode of ['view', 'edit']) {
    test(`${documentType} initializes its real toolbar in ${mode} mode without a configured user`, async ({ page }) => {
      test.setTimeout(60_000)
      const errors: string[] = []
      const scripts: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => {
        const path = new URL(request.url()).pathname
        if (path.endsWith('/api/documents/api.js') || path.endsWith('/main/app.js')) {
          scripts.push(request.url())
        }
      })

      // 使用真实 SDK 和空文档模板，仅切换模式，复现匿名只读预览的初始化路径。
      await page.route('**/api/documents/api.js*', async route => {
        const response = await route.fetch()
        await route.fulfill({
          response,
          body: `${await response.text()}
            const OriginalDocEditor = DocsAPI.DocEditor;
            DocsAPI.DocEditor = function (id, config) {
              config.editorConfig.mode = ${JSON.stringify(mode)};
              config.document.permissions.edit = ${mode === 'edit'};
              return new OriginalDocEditor(id, config);
            };
          `,
        })
      })

      await page.goto('/')
      await page.getByRole('button', { name: '新建/打开文件', exact: true }).click()
      await page.locator(`[template="${documentType}"]`).click()

      const editor = page.frameLocator('iframe[name="frameEditor"]')
      await expect(editor.locator('.ribtab:visible').first()).toBeVisible({ timeout: 45_000 })
      const frameUrl = await page.locator('iframe[name="frameEditor"]').getAttribute('src')
      const version = new URL(frameUrl!).searchParams.get('_dc')
      expect(version).toMatch(/^[a-f0-9]{16}$/)
      expect(scripts).toHaveLength(2)
      expect(scripts.map(url => new URL(url).searchParams.get('v'))).toEqual([version, version])
      // 工具栏缩放事件也必须在初始化完成后正常执行。
      await page.setViewportSize({ width: 900, height: 700 })
      await expect(editor.locator('.ribtab:visible').first()).toBeVisible()
      expect(errors).toEqual([])
    })
  }
}
