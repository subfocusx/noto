import { expect, test } from '@playwright/test';
import { gotoApp } from '../helpers/app';

test.describe('responsive layout', () => {
  test('the sidebar is a drawer on narrow screens and the layout does not overflow', async ({
    page,
  }) => {
    await gotoApp(page);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const width = viewport!.width;

    const sidebarWrap = page.locator('.sidebar-wrap');
    await expect(sidebarWrap).toBeAttached();

    if (width <= 820) {
      /* --------------------------------------------------- mobile: drawer */
      const menuButton = page.getByRole('button', { name: 'Toggle navigation' });
      await expect(menuButton).toBeVisible();

      // The drawer is closed: the sidebar is translated out of the viewport.
      const sidebarX = async () => (await sidebarWrap.boundingBox())!.x;
      const sidebarWidth = async () => (await sidebarWrap.boundingBox())!.width;
      await expect
        .poll(async () => (await sidebarX()) + (await sidebarWidth()), { timeout: 5000 })
        .toBeLessThanOrEqual(1);

      // Opening the drawer brings the sidebar into view (the slide is animated).
      await menuButton.click();
      await expect(page.locator('.app.drawer-open')).toHaveCount(1);
      await expect.poll(async () => sidebarX(), { timeout: 5000 }).toBeGreaterThanOrEqual(-1);

      // The editor uses the full screen width (the sidebar is an overlay).
      const editorBox = await page.locator('.cm-editor').boundingBox();
      expect(editorBox).not.toBeNull();
      expect(Math.abs(editorBox!.width - width)).toBeLessThanOrEqual(20);
    } else {
      /* -------------------------------------------------- desktop: sidebar */
      const box = await sidebarWrap.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.width).toBeGreaterThan(0);
    }

    // No horizontal overflow in either layout.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
  });

  /**
   * APPLICATION BUG (frontend/src/styles.css): the hamburger button must only be
   * visible below the 820px breakpoint, but `.icon-button { display: inline-flex }`
   * (styles.css:155) is declared after `.menu-button { display: none }`
   * (styles.css:108) with the same specificity, so the later rule wins and the
   * button stays visible on desktop.
   */
  test('the hamburger button is hidden above the 820px breakpoint', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');

    await gotoApp(page);
    await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeHidden();
  });
});
