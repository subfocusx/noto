/**
 * The rail of the sections and the column that stands next to it.
 *
 * The rail is an accordion: the icon that is pressed decides what the column
 * shows, and exactly one section is open at a time. The column itself never
 * disappears: the left side of the window always shows where the sections are.
 */
import { expect, test } from '@playwright/test';
import { createFolder, createNote, gotoApp, openSidebarIfNeeded } from '../helpers/app';

/** A unique suffix: the two projects of the run share the same storage. */
function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('the rail of the sections', () => {
  test('the rail shows the seven sections and the actions of the application', async ({
    page,
  }) => {
    await gotoApp(page);

    const rail = page.locator('.rail');
    await expect(rail).toBeVisible();

    for (const name of [
      'Explorer',
      'Favorites',
      'Calendar',
      'Search',
      'Filters',
      'History',
      'Notifications',
      'Trash',
    ]) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }

    // There is no letter under the icon any more: the name of the section lives
    // in the accessible name and in the tooltip of the button.
    await expect(page.locator('.rail-letter')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute(
      'title',
      'Explorer',
    );

    // The sections are in two groups, separated by a thin line.
    await expect(page.locator('.rail-items .rail-separator')).toHaveCount(1);

    // The theme and the settings live at the bottom of the rail.
    await expect(page.getByRole('button', { name: /Switch to the .* theme/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  });

  test('the icon of the section switches the column', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The explorer is the section that is open when the application starts.
    await expect(page.locator('.column-section[aria-label="Explorer"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.locator('.column-section[aria-label="History"]')).toBeVisible();
    await expect(page.locator('.column-section[aria-label="Explorer"]')).toHaveCount(0);

    // Exactly one section is open at a time.
    await expect(page.locator('.column-section')).toHaveCount(1);
    await expect(page.locator('.rail-item[aria-current="page"]')).toHaveCount(1);
  });

  test('the search and the filters open one window over the explorer', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // The magnifier opens the window with the search.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Search notes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
    // The column of the explorer keeps the tree: the window does not replace it.
    await expect(page.locator('.column-section[aria-label="Explorer"]')).toBeVisible();

    // The funnel opens the same window in the other module.
    await page.getByRole('tab', { name: 'Filters' }).click();
    await expect(page.getByRole('tab', { name: 'Filters' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Filter of the notes')).toBeVisible();
    await expect(page.locator('.column-section[aria-label="Explorer"]')).toBeVisible();

    // Escape closes the window, and the column is still the explorer.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search notes' })).toHaveCount(0);
    await expect(page.locator('.column-section[aria-label="Explorer"]')).toBeVisible();
  });

  test('the column of the notes cannot be hidden', async ({ page }) => {
    await gotoApp(page);

    // There is no toggle of the column any more: the rail is the navigation.
    await expect(page.getByRole('button', { name: 'Toggle notes panel' })).toHaveCount(0);
    await expect(page.locator('.sidebar-wrap')).toBeAttached();
    await expect(page.locator('.rail')).toBeAttached();
  });

  test('the headers of the columns share one line', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    // A note is opened, so the strip of the tabs is on the screen.
    const folder = unique('rail-folder');
    await createFolder(page, folder);
    await createNote(page, folder, `${unique('rail-note')}.md`);

    const top = async (selector: string) => {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) return null;
      const box = await locator.boundingBox();
      return box ? { y: Math.round(box.y), h: Math.round(box.height) } : null;
    };

    const column = await top('.column-header');
    const tabs = await top('.tab-strip');
    const outline = await top('.outline-header');

    expect(column).not.toBeNull();
    expect(tabs).not.toBeNull();

    // Every header stands at the same height and has the same height: the line
    // under the headers is one line.
    //
    // The drawer is a fixed element and the emulation of a mobile screen
    // shifts it by a few pixels, so the tops are compared with a tolerance.
    expect(Math.abs(tabs!.y - column!.y)).toBeLessThanOrEqual(4);
    expect(tabs!.h).toBe(column!.h);

    // On a narrow screen the outline is an overlay over the editor, so it has
    // no header of its own on the screen.
    if (outline) {
      expect(Math.abs(outline!.y - column!.y)).toBeLessThanOrEqual(4);
      expect(outline!.h).toBe(column!.h);
    }
  });

  test('the section of the rail is remembered', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.locator('.column-section[aria-label="History"]')).toBeVisible();

    await page.reload();
    await openSidebarIfNeeded(page);
    await expect(page.locator('.column-section[aria-label="History"]')).toBeVisible();
  });

  test('the calendar and the notifications open their column', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(page.locator('.column-section[aria-label="Calendar"]')).toBeVisible();

    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.locator('.column-section[aria-label="Notifications"]')).toBeVisible();
    await expect(page.locator('.column-section[aria-label="Calendar"]')).toHaveCount(0);
  });
});
