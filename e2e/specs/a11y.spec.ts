/**
 * The keyboard operation of the application: every action of the interface has
 * to be reachable without the mouse and the focus has to be visible.
 */
import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

test.describe('the keyboard operation', () => {
  test('the command palette opens and closes with the keyboard', async ({ page }) => {
    await gotoApp(page);

    await page.keyboard.press('Control+k');
    await expect(page.locator('.noto-palette-input')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.noto-palette-input')).toBeHidden();
  });

  test('a dialog traps the focus and closes with Escape', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New note' });
    await expect(dialog).toBeVisible();

    // The focus is inside the dialog.
    const inside = await page.evaluate(() => {
      const active = document.activeElement;
      const box = document.querySelector('[role="dialog"]');
      return Boolean(active && box && box.contains(active));
    });
    expect(inside).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the tree can be operated with the keyboard', async ({ page }) => {
    await gotoApp(page);

    const toggle = page.getByRole('button', { name: 'Expand', exact: false }).first();
    if ((await toggle.count()) === 0) return;

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Collapse', exact: false }).first()).toBeVisible();
  });

  test('every interactive element has an accessible name', async ({ page }) => {
    await gotoApp(page);

    const unnamed = await page.evaluate(() => {
      const selector = 'button, a[href], input, select, textarea';
      const nodes = Array.from(document.querySelectorAll(selector));
      return nodes
        .filter((node) => {
          const element = node as HTMLElement;
          if (element.offsetParent === null && element.getClientRects().length === 0) return false;
          const label =
            element.getAttribute('aria-label') ??
            element.getAttribute('title') ??
            element.textContent ??
            '';
          return label.trim().length === 0;
        })
        .map((node) => (node as HTMLElement).className || node.tagName);
    });

    expect(unnamed).toEqual([]);
  });

  test('the focus is visible on the buttons of the header', async ({ page }) => {
    await gotoApp(page);

    const button = page.getByRole('button', { name: 'Toggle theme' });
    await button.focus();

    const outline = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const style = window.getComputedStyle(active);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(outline).not.toBeNull();
    expect(outline!.outlineStyle).not.toBe('none');
  });
});
