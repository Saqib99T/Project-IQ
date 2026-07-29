// FLOW — RCA Governance, end to end: the policy builder that auto-requires an
// RCA, the full lifecycle on a real completed incident (evidence checklist,
// root-cause fields, verified action items), and the recording evidence tie-in
// that's blocking a different RCA from moving forward. Self-narrating — see
// lib/annotate.js. Logs in once as the Tenant Admin (blue@example.com).
import { test, expect } from '@playwright/test';
import { loginItsm } from '../lib/login.js';
import { say, highlight, clear } from '../lib/annotate.js';

test('Flow — RCA governance, narrated', async ({ page }) => {
  await test.step('Sign in as Tenant Admin', async () => {
    await loginItsm(page, 'blue@example.com');
    await page.waitForTimeout(1400);
    await say(page, "**RCA governance** — every serious failure gets a reviewed, approved root-cause report with tracked corrective actions. Not a text box, a workflow.", { tag: 'ITSM · RCA', holdMs: 5000 });
  });

  await test.step('The policy builder — RCA is required by rule', async () => {
    await clear(page); // the intro bubble's own text also matches "RCA governance" below
    await page.getByText(/administration/i).first().click();
    await page.waitForTimeout(1000);
    await page.getByText(/on-call & sre/i).click();
    await page.waitForTimeout(800);
    // scope to the sidebar nav button specifically — a getByText regex here
    // would also match this step's own comment bubble once it's showing
    const link = page.getByRole('button', { name: 'RCA Governance' });
    await highlight(link, 800);
    await link.click();
    await page.waitForTimeout(1600);
    await say(page, "RCA is **policy-driven**, not manually remembered. \"Major incident postmortem\" auto-requires an RCA for critical/high-severity incidents — with an owner role, an approver role, and a due date, all pre-assigned.", { tag: 'RCA Policies', holdMs: 5200 });
  });

  await test.step('A second policy — SLA breach on a high/critical ticket', async () => {
    const policy = page.getByText(/sla breach on high\/critical ticket/i);
    await highlight(policy, 1400);
    await say(page, "Policies are evaluated by priority, first match wins. A breached SLA on a high/critical ticket triggers its own RCA — owned by the assignee this time, not a team lead.", { tag: 'Policy priority', holdMs: 4800 });
  });

  await test.step('Open the completed RCA on a real incident', async () => {
    await clear(page);
    await page.getByRole('link', { name: /^incidents$/i }).click();
    await page.waitForTimeout(1600);
    await page.getByRole('tab', { name: /^incidents$/i }).click().catch(() => page.getByText(/^incidents$/i).last().click());
    await page.waitForTimeout(1300);
    await page.getByText(/payments api outage/i).first().click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/rca-2026-0001/i)).toBeVisible();
    const rcaBadge = page.getByText(/^completed$/i).first();
    await highlight(rcaBadge, 1200);
    await say(page, "**RCA‑2026‑0001** — this incident's RCA, already completed. Root cause, contributing factors, detection gap, prevention plan — all captured before anyone could mark it done.", { tag: 'RCA record', holdMs: 5000 });
  });

  await test.step('The evidence checklist — every box actually checked', async () => {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(700);
    const checklist = page.getByText(/evidence checklist/i);
    await highlight(checklist, 1200);
    await say(page, "**11 required evidence types** — timeline, customer impact, recording, SLA breach data, customer communication, and more — every one \"provided,\" not skipped. This is what gates approval.", { tag: 'Evidence checklist', holdMs: 5200 });
  });

  await test.step('Action items — verified, not just closed', async () => {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(700);
    const actionItems = page.getByText(/action items/i).first();
    await highlight(actionItems, 1200);
    await say(page, "Both corrective actions are **done** — adding a canary deploy stage, tuning alert routing — each with a named owner. An RCA can't quietly reach \"completed\" while a required action stays open.", { tag: 'Action items (CAPA)', holdMs: 5200 });
  });

  await test.step('Why a different RCA is stuck: the recording behind it', async () => {
    await clear(page);
    await page.getByRole('link', { name: /^tickets$/i }).click();
    await page.waitForTimeout(1600);
    await page.getByText(/payroll app slow/i).first().click();
    await page.waitForTimeout(2000);
    await page.getByText(/^recordings$/i).first().click();
    await page.waitForTimeout(1800);
    await say(page, "This ticket's recording is flagged **sensitive** — consent disputed, so its AI summary was skipped entirely. That single gap is exactly what's blocking this ticket's RCA from moving past review.", { tag: 'Recording evidence', holdMs: 5400 });
  });

  await test.step('A recording that never made it — inaccessible', async () => {
    await clear(page);
    await page.getByRole('link', { name: /^tickets$/i }).click();
    await page.waitForTimeout(1600);
    await page.getByText(/office vpn down/i).first().click();
    await page.waitForTimeout(1800);
    const recTab = page.getByText(/^recordings$/i).first();
    if (await recTab.isVisible({ timeout: 4000 }).catch(() => false)) {
      await recTab.click();
      await page.waitForTimeout(1600);
    }
    await say(page, "A required recording that's gone **inaccessible** — an expired link nobody re-shared — is a realistic, everyday reason an RCA sits untouched past its due date instead of a mystery.", { tag: 'Missing evidence', holdMs: 5000 });
  });
});
