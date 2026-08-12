import { expect, test } from '@playwright/test'

test('edits a grouped figure without an assistant', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await page.getByRole('button', { name: 'Ellipse' }).click()

  const layerRows = page.locator('.layer-name')
  await layerRows.filter({ hasText: 'Rectangle' }).click()
  await layerRows.filter({ hasText: 'Ellipse' }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Group selected layers' }).click()

  await expect(page.getByLabel('TikZ source')).toContainText('begin{scope}')
  await expect(page.locator('.layer-name').filter({ hasText: 'Group' })).toBeVisible()
  await expect(page.getByLabel('Figure artboard').locator('.shape')).toHaveCount(2)
})
