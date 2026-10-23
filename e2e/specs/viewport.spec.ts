/**
 * The matrix of the viewports of the redesign.
 *
 * The application has to be usable on every size: no horizontal overflow, no
 * clipped control, a working editor and a dialog that fits into the screen.
 */
import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
];

test.describe('the viewport matrix', () => {
  for (const viewport of VIEWPORTS) {
    test(`the layout fits into ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await gotoApp(page);

      // No horizontal overflow.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);

      // The editor is visible and has a usable width.
      const editor = await page.locator('.cm-editor').boundingBox();
      expect(editor).not.toBeNull();
      expect(editor!.width).toBeGreaterThan(120);
      expect(editor!.height).toBeGreaterThan(80);

      // The header of the column is not covered and the title is readable.
      await expect(page.locator('.app-title')).toBeVisible();

      // Every button of the permanent status bar fits into the screen.
      const buttons = page.locator('.app-footer button');
      const count = await buttons.count();
      for (let index = 0; index < count; index += 1) {
        const box = await buttons.nth(index).boundingBox();
        if (!box) continue;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    });
  }

  test('a dialog fits into a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New note' });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(361);
    expect(box!.height).toBeLessThanOrEqual(801);

    // The button of the dialog is reachable and not covered.
    const ok = dialog.getByRole('button', { name: 'OK', exact: true });
    await expect(ok).toBeVisible();
    const okBox = await ok.boundingBox();
    expect(okBox).not.toBeNull();
    expect(okBox!.x + okBox!.width).toBeLessThanOrEqual(361);
  });
});
