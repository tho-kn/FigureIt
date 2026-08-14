import { expect, test } from '@playwright/test'

test('edits a grouped figure without an assistant', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click()

  const layerRows = page.locator('.layer-name')
  await layerRows.filter({ hasText: 'Rectangle' }).click()
  await layerRows.filter({ hasText: 'Ellipse' }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Group selected layers' }).click()

  await expect(page.getByLabel('TikZ source')).toContainText('begin{scope}')
  await expect(page.locator('.layer-name').filter({ hasText: 'Group' })).toBeVisible()
  await expect(page.getByLabel('Figure artboard').locator('.shape')).toHaveCount(2)
})

test('keeps the canvas usable at the narrow Android breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await page.goto('/')

  const canvas = await page.locator('.canvas-area').boundingBox()
  const artboard = await page.getByLabel('Figure artboard').boundingBox()
  expect(canvas).not.toBeNull()
  expect(artboard).not.toBeNull()
  expect(canvas!.height).toBeGreaterThan(220)
  expect(Math.min(canvas!.y + canvas!.height, artboard!.y + artboard!.height)).toBeGreaterThan(Math.max(canvas!.y, artboard!.y))
})
