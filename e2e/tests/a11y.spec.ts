// WCAG 2.1 AA on every page (axe), signed in, and the screenshots (@shots).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { signIn } from '../helpers/auth';
import { ROOT } from '../helpers/env';

const PAGES = ['line', 'pipe', 'librarian', 'badges', 'backup', 'custody', 'layers'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('every page passes axe WCAG 2.1 AA', async ({ page }) => {
  await signIn(page, 'ada');
  for (const p of PAGES) {
    await page.goto(`/#/${p}`);
    await page.locator('.vg-hero').waitFor();
    await page.waitForTimeout(800); // let the page's first read land
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => `${p}: ${v.id}`), p).toEqual([]);
  }
});

for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
  test(`@shots ${size}`, async ({ page }) => {
    await signIn(page, 'ada'); // at desktop size: the phone topbar folds the person menu away
    await page.setViewportSize(viewport);
    for (const p of PAGES) {
      await page.goto(`/#/${p}`);
      await page.locator('.vg-hero').waitFor();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(ROOT, 'docs/screenshots', `${p}-${size}.png`), fullPage: true });
    }
  });
}
