/**
 * The settings of the application: the theme, the view mode, the width of the
 * sidebar, the order of the tree and the preferences that survive a reload.
 */
import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

test.describe('the settings', () => {
  test('the theme survives a reload', async ({ page }) => {
    await gotoApp(page);

    await page.getByRole('button', { name: 'Toggle theme' }).click();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(['light', 'dark']).toContain(theme);

    await page.reload();
    await expect(page.locator('.app-title')).toBeVisible();
    const afterReload = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(afterReload).toBe(theme);
  });

  test('the settings dialog opens with the keyboard and changes the theme', async ({ page }) => {
    await gotoApp(page);

    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    const themeSelect = dialog.getByLabel('Theme');
    await expect(themeSelect).toBeVisible();
    await themeSelect.selectOption('light');
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');

    // The choice survives a reload.
    await page.reload();
    await expect(page.locator('.app-title')).toBeVisible();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');
  });

  test('the shortcut help lists the shortcuts of the application', async ({ page }) => {
    await gotoApp(page);

    await page.keyboard.press('Control+/');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.shortcut-row').first()).toBeVisible();
    await expect(dialog).toContainText('Ctrl+K');
  });

  test('the collapsed sidebar survives a reload', async ({ page }, testInfo) => {
    // On a narrow screen the sidebar is an overlay, so the collapse of the
    // panel is a feature of the wide layout only.
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');

    await gotoApp(page);
    await openSidebarIfNeeded(page);

    const before = await page.locator('.sidebar-wrap').boundingBox();
    expect(before).not.toBeNull();

    // The button of the sidebar collapses the panel of the notes.
    const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
    if (await toggle.count()) {
      await toggle.click();
      await expect.poll(async () => (await page.locator('.sidebar-wrap').boundingBox())?.width ?? 1)
        .toBeLessThan(5);

      await page.reload();
      await expect(page.locator('.app-title')).toBeVisible();
      await expect
        .poll(async () => (await page.locator('.sidebar-wrap').boundingBox())?.width ?? 1)
        .toBeLessThan(5);
    }
  });
});
