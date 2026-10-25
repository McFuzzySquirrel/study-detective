import { expect, test } from '@playwright/test';

test('serves the app shell from the static build', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Notes Detective' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
