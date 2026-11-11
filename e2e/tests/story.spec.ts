// The story through a real browser and Keycloak's real sign-in form.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/auth';

const postFromPage = (page: import('@playwright/test').Page, path: string, body: object) =>
  page.evaluate(async ([p, b]) => (await fetch(p as string, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, [path, body] as const);

test('signed out: the line asks for a sign-in, the act buttons are off', async ({ page }) => {
  await page.goto('/#/line');
  await expect(page.getByText('Sign in to see the workloads.')).toBeVisible();
  await page.goto('/#/pipe');
  await expect(page.getByRole('button', { name: /Seal the handbook/ })).toBeDisabled();
  expect(await postFromPage(page, '/api/acts/ingest', { collection: 'handbook' })).toBe(401);
});

test('the line: every workload\'s powers, as its own token reports them', async ({ page }) => {
  await signIn(page, 'vera');
  await page.goto('/#/line');
  const scribe = page.getByRole('article', { name: /scribe/ });
  await expect(scribe).toContainText('spiffe://pipeline.lab/workload/scribe');
  await expect(scribe.getByRole('list', { name: /What Vault lets scribe do/ })).toContainText('transit/datakeys/plaintext/board');
});

test('a staff member cannot press an act, and the console refuses her too', async ({ page }) => {
  await signIn(page, 'vera');
  await page.goto('/#/pipe');
  await expect(page.getByRole('button', { name: /Seal the board/ })).toBeDisabled();
  await expect(page.getByTestId('action-reason')).toContainText('not in pipeline-operators');
  expect(await postFromPage(page, '/api/acts/ingest', { collection: 'board' })).toBe(403);
});

test('an operator seals the handbook; the database shows ciphertext', async ({ page }) => {
  await signIn(page, 'oscar');
  await page.goto('/#/pipe');
  await page.getByRole('button', { name: /Seal the handbook/ }).click();
  await expect(page.locator('.event--good').filter({ hasText: 'travel-policy' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('cell', { name: 'travel-policy' })).toBeVisible();
});

test('vera asks about the board: Vault will not open it for her', async ({ page }) => {
  await signIn(page, 'vera');
  await page.goto('/#/librarian');
  await page.getByRole('button', { name: 'What is Project Lighthouse?' }).click();
  await expect(page.getByText(/Vault would not open board-2026-10/)).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.answer')).toContainText('Vault will not open for you');
  await expect(page.getByText('token revoked')).toBeVisible();
});

test('ada asks the same question and gets an answer with sources', async ({ page }) => {
  await signIn(page, 'ada');
  await page.goto('/#/librarian');
  await page.getByRole('button', { name: 'What is Project Lighthouse?' }).click();
  await expect(page.locator('.answer')).toContainText('Saltmere', { timeout: 150_000 });
  await expect(page.getByText(/Sources:/)).toContainText('board-2026-10');
});

test('the badge check shows the guest lists and the passing verifier tests', async ({ page }) => {
  await page.goto('/#/badges');
  await expect(page.getByRole('article', { name: "keeper's doors" })).toContainText('store');
  await expect(page.getByText(/passed, 0 failed/)).toBeVisible();
});
