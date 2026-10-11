import { test, expect } from '@playwright/test'

test('visits the app root url', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '欢迎使用文档编辑器' })).toBeVisible()
})

test('shows a clear hint when remote file loading fails inside an iframe', async ({ page }) => {
  await page.goto('/#/?filename=example.docx&url=http%3A%2F%2Flocalhost%3A8118%2Fapi%2Ffiles%2Fexample.docx')

  await expect(page.getByText('文件加载失败')).toBeVisible()
  await expect(page.getByText('请点击右上角在新窗口打开的按钮')).toBeVisible()
})
