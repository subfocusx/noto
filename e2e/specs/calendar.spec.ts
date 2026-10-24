/**
 * The calendar of the vault.
 *
 * The section shows a month of the vault: the days that carry notes are marked
 * with a dot, and the notes of the day the user picked are listed under the
 * grid. The data comes from the tree — a note belongs to the day it was written
 * on and to the day it was changed on.
 */
import { expect, test } from '@playwright/test';
import { gotoApp, openSidebarIfNeeded } from '../helpers/app';

test.describe('the calendar of the vault', () => {
  test('the calendar shows a month and walks through the months', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const section = page.locator('.column-section[aria-label="Calendar"]');
    await expect(section).toBeVisible();

    // The grid is a month of six rows of seven days.
    await expect(section.locator('.calendar-grid .calendar-day')).toHaveCount(42);
    await expect(section.locator('.calendar-weekday')).toHaveCount(7);

    // The name of the month is written above the grid.
    const label = section.locator('.calendar-month');
    await expect(label).toHaveText(/^[A-Z][a-z]+ \d{4}$/);

    // The next month is not the same month as the one that is shown.
    const before = await label.innerText();
    await section.getByRole('button', { name: 'Next month' }).click();
    await expect(label).not.toHaveText(before);

    // And the previous month brings the calendar back.
    await section.getByRole('button', { name: 'Previous month' }).click();
    await expect(label).toHaveText(before);
  });

  test('a day with a note is marked and its notes are listed', async ({ page }) => {
    await gotoApp(page);
    await openSidebarIfNeeded(page);

    const note = `calendar-${Date.now().toString(36)}.md`;
    await page.evaluate(async (name) => {
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: '', name }),
      });
    }, note);
    await page.reload();
    await openSidebarIfNeeded(page);

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const section = page.locator('.column-section[aria-label="Calendar"]');
    await expect(section).toBeVisible();

    // The day of today carries the note, so it is marked with a dot.
    const cell = section.locator('.calendar-day').filter({ has: page.locator('.calendar-dot') });
    await expect(cell.first()).toBeVisible();

    // The day can be picked, and the note of the day is listed. The vault
    // holds other notes of the same day, so the list is checked for the note
    // of this test and not for the first one.
    await cell.first().click();
    await expect(section.locator('.calendar-day-selected')).toHaveCount(1);
    await expect(section.locator('.calendar-note-list')).toBeVisible();
    await expect(section.locator('.calendar-note-name').filter({ hasText: note })).toHaveCount(1);
  });
});
