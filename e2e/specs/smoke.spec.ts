import { expect, test } from '@playwright/test';

test('the app loads, the health endpoint answers and the empty state is visible', async ({
  page,
  request,
}) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  const body = (await health.json()) as { status?: string; version?: string };
  expect(body.status).toBe('ok');
  expect(typeof body.version).toBe('string');

  await page.goto('/');

  // The header shows the product name while no note is selected.
  await expect(page.locator('.app-title')).toHaveText('Noto');
  await expect(page.getByTestId('file-tree')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toContainText('No note selected');

  // The API is reachable from the browser origin as well.
  const inPage = await page.evaluate(async () => {
    const res = await fetch('/api/health');
    return { status: res.status, body: await res.text() };
  });
  expect(inPage.status).toBe(200);
  expect(JSON.parse(inPage.body).status).toBe('ok');
});
