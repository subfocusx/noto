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

      // The rail of the sections stays where it is: it is the navigation of
      // the application and it never disappears.
      await expect(page.locator('.rail')).toBeVisible();

      // The drawer is closed: the column is translated out of the viewport,
      // right behind the rail.
      const railWidth = (await page.locator('.rail').boundingBox())!.width;
      const sidebarX = async () => (await sidebarWrap.boundingBox())!.x;
      const sidebarWidth = async () => (await sidebarWrap.boundingBox())!.width;
      await expect
        .poll(async () => (await sidebarX()) + (await sidebarWidth()), { timeout: 5000 })
        .toBeLessThanOrEqual(railWidth + 1);

      // Opening the drawer brings the column into view (the slide is animated).
      await menuButton.click();
      await expect(page.locator('.app.drawer-open')).toHaveCount(1);
      await expect.poll(async () => sidebarX(), { timeout: 5000 }).toBeGreaterThanOrEqual(-1);

      // The editor uses the width that is left (the rail takes its part).
      const editorBox = await page.locator('.cm-editor').boundingBox();
      expect(editorBox).not.toBeNull();
      expect(Math.abs(editorBox!.width - (width - railWidth))).toBeLessThanOrEqual(20);
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
   * The button of the drawer is only useful on a narrow screen: above the
   * breakpoint of 820 px the column of the sections stands where it is, and the
   * button would be a control that changes nothing.
   */
  test('the hamburger button is hidden above the 820px breakpoint', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only');

    await gotoApp(page);
    await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeHidden();
  });
});
