import { test, expect } from '@playwright/test';

test('renders key sections and links', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-section="TERMINAL_WINDOW"]')).toBeVisible();
  await expect(page.locator('[data-section="SCREEN_VIEWPORT"]')).toBeVisible();
  const items = page.locator('[data-section="LINK_ITEM"]');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
});

test('skip link is keyboard-focusable', async ({ page }) => {
  await page.goto('/');
  // First Tab should land on skip link
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip-link');
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeVisible();
});

test('external links have rel and target', async ({ page }) => {
  await page.goto('/');
  const anchors = page.locator('[data-section="LINKS_LIST"] a');
  const count = await anchors.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const a = anchors.nth(i);
    await expect(a).toHaveAttribute('target', '_blank');
    const rel = await a.getAttribute('rel');
    expect(rel || '').toContain('noopener');
    expect(rel || '').toContain('noreferrer');
  }
});

test('prefers-reduced-motion can be emulated', async ({ page, context }) => {
  await context.grantPermissions([]);
  await context.setDefaultNavigationTimeout(30000);
  await context.setDefaultTimeout(30000);
  await context.tracing?.start({ screenshots: false, snapshots: false });
  await context.newCDPSession(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  expect(reduced).toBe(true);
});
