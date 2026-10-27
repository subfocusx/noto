import { expect, test } from '@playwright/test';
import { gotoApp } from '../helpers/app';

/**
 * The empty state of the writing plane.
 *
 * The plane is the biggest block of the application, and an empty plane is
 * not a void: the state offers the two actions that start a note, and they
 * must really work — the block is above the editor and the clicks must reach
 * it.
 */
test.describe('the empty state of the plane', () => {
  test('offers a new note and the note of the day', async ({ page }) => {
    await gotoApp(page);

    const empty = page.getByTestId('empty-state');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Create a note' })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Note of the day' })).toBeVisible();
  });

  test('the new note opens the dialog of the name', async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId('empty-state').getByRole('button', { name: 'Create a note' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('the note of the day opens the editor', async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId('empty-state').getByRole('button', { name: 'Note of the day' }).click();
    await expect(page.getByTestId('markdown-editor')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toHaveCount(0);
  });
});
