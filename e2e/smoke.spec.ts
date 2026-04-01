import { expect, test } from '@playwright/test';

test('loads app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/ZenTeams/i);
});
