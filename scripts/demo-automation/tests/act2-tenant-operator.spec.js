// ACT 2 — Tenant Operator: claim the live chat from Act 1, work it in the
// console, then switch to the same ticket at ITSM agent tier.
// Mirrors docs/full-app-demo-script.html Act 2. Depends on Act 1 having run
// first (there needs to be a queued/claimed session and a ticket to open) —
// falls back gracefully if it hasn't. Self-narrating — see lib/annotate.js.
import { test, expect } from '@playwright/test';
import { loginPortal } from '../lib/login.js';
import { say, highlight, clear } from '../lib/annotate.js';

test('Act 2 — Tenant Operator handles the live chat and the ticket', async ({ page }) => {
  await test.step('Sign in to the Operator Console', async () => {
    await loginPortal(page, 'blue.opt@example.com');
    await expect(page).toHaveURL(/\/portal\/operator/, { timeout: 15_000 });
    await say(page, "Same login system as Act 1 — this identity just carries the **Operator** role instead.", { tag: 'Act 2 · Tenant Operator' });
  });

  await test.step('Claim the waiting session (or open the one already claimed)', async () => {
    const acceptBtn = page.getByRole('button', { name: /accept/i }).first();
    if (await acceptBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await highlight(acceptBtn, 1200);
      await acceptBtn.click();
      await page.waitForTimeout(1800);
    }
    // "My Sessions" entries are real <a href="/operator/sessions/{id}"> links —
    // target that structurally so repeat runs (which pile up old sessions and
    // a same-text queue entry) don't produce an ambiguous text match.
    await page.locator('a[href*="/operator/sessions/"]').first().click();
    await page.waitForTimeout(2200);
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "This is the conversation from Act 1 — the operator sees exactly why it escalated and can pick it up mid-context.", { tag: 'Live session', holdMs: 4200 });
  });

  await test.step('Reply, use a canned response', async () => {
    const messageBox = page.getByPlaceholder(/type a message/i);
    await messageBox.fill("Hi, this is Blue Operator — I can see your ticket, let's get this sorted.");
    await page.getByRole('button', { name: /^send$/i }).click();
    await page.waitForTimeout(1800);

    await page.getByText(/canned replies/i).click();
    await page.waitForTimeout(900);
    await page.getByText(/^greeting$/i).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /^send$/i }).click();
    await page.waitForTimeout(1800);
    await say(page, "Canned responses speed up the routine replies — the operator still chooses and sends every one.", { tag: 'Canned replies' });
  });

  await test.step('Resolve the session', async () => {
    await clear(page);
    await page.getByRole('button', { name: '✓ Resolve' }).click();
    await page.waitForTimeout(2200);
  });

  await test.step('Open the same ticket at agent tier', async () => {
    await page.getByText(/^tickets$/i).click();
    await page.waitForTimeout(2200);
    await page.getByText(/laptop reboots randomly/i).first().click();
    await page.waitForTimeout(2200);

    // SLA countdown is visible to everyone; the internal-note toggle below is
    // the thing that's exclusive to agent tier and up.
    await expect(page.getByText(/first response|resolution/i).first()).toBeVisible();
    await say(page, "Same login, same person — this is the ITSM **agent** tier, not a separate system. Notice the live SLA countdown on the right.", { tag: 'ITSM · agent tier', holdMs: 4200 });
  });

  await test.step('Add an internal note and move the ticket forward', async () => {
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(600);
    const noteBox = page.getByLabel(/internal note/i);
    await highlight(noteBox, 1200);
    await noteBox.check();
    await page.getByPlaceholder(/write a comment/i).fill('Checked event logs — looks thermal, not a driver issue. Escalating to hardware for a fan/heatsink inspection.');
    await say(page, "The internal/public toggle only appears at agent tier and up — an end_user never sees this note.", { tag: 'Internal note' });
    await page.getByRole('button', { name: /post comment/i }).click();
    await page.waitForTimeout(1800);

    await page.locator('select').first().selectOption('in_progress');
    await page.waitForTimeout(1800);
  });
});
