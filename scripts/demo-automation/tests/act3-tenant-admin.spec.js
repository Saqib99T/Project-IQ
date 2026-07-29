// ACT 3 — Tenant Admin: portal admin (Organization + Integrations), then ITSM
// admin (SLA/On-Call/SRE/RCA governance), the seeded RCA lifecycle, and a
// ticket's Recordings tab. Mirrors docs/full-app-demo-script.html Act 3 — the
// centerpiece of the demo. Self-narrating — see lib/annotate.js.
import { test, expect } from '@playwright/test';
import { loginPortal, loginItsm } from '../lib/login.js';
import { say, highlight, clear } from '../lib/annotate.js';

test('Act 3 — Tenant Admin runs the operation', async ({ page }) => {
  await test.step('Portal admin: Organization overview', async () => {
    await loginPortal(page, 'blue@example.com');
    await expect(page).toHaveURL(/\/portal\/admin/, { timeout: 15_000 });
    await say(page, "The **Tenant Admin** — everything a tenant owns and can self-serve, pinned hard to just this org.", { tag: 'Act 3 · Tenant Admin' });
    await page.getByRole('link', { name: /^analytics$/i }).click().catch(() => {});
    await page.waitForTimeout(1800);
  });

  await test.step('Portal admin: Integrations marketplace', async () => {
    await page.getByRole('link', { name: /integrations/i }).click();
    await page.waitForTimeout(2200);
    await expect(page.getByText(/marketplace/i).first()).toBeVisible();
    await say(page, "This used to be **platform-only**. Tenant admins can wire their own Teams/webhook integrations now, scoped automatically to just their org.", { tag: 'Integrations', holdMs: 4200 });
  });

  await test.step('Switch to ITSM as the same admin', async () => {
    await clear(page);
    await loginItsm(page, 'blue@example.com');
    await page.getByText(/administration/i).first().click();
    await page.waitForTimeout(1800);
  });

  await test.step('Tour Service Catalog and On-Call & SRE', async () => {
    await page.getByText(/^service catalog$/i).click();
    await page.waitForTimeout(900);
    await page.getByText(/on-call & sre/i).click();
    await page.waitForTimeout(900);
    await page.getByText(/reliability/i).click();
    await page.waitForTimeout(1800);
    // the seeded error-budget story: Payments meeting, Web at-risk
    await expect(page.getByText(/payments api availability/i)).toBeVisible();
    await expect(page.getByText(/web platform availability/i)).toBeVisible();
    await say(page, "**Payments API** is meeting its error-budget target; **Web Platform** is at risk. This is telemetry-fed reliability, separate from ticket SLAs.", { tag: 'Reliability (SLO)', holdMs: 4200 });
  });

  await test.step('RCA policy builder', async () => {
    await page.getByText(/rca governance/i).click();
    await page.waitForTimeout(1800);
    await expect(page.getByText(/major incident postmortem/i)).toBeVisible();
    await say(page, "RCA is **policy-driven** — auto-required by rule (major incident, SLA breach) rather than a manager having to remember.", { tag: 'RCA Governance' });
  });

  await test.step('The RCA lifecycle on a real incident', async () => {
    await clear(page);
    await page.getByRole('link', { name: /^incidents$/i }).click();
    await page.waitForTimeout(1800);
    await page.getByRole('tab', { name: /^incidents$/i }).click().catch(() => page.getByText(/^incidents$/i).last().click());
    await page.waitForTimeout(1400);
    await page.getByText(/payments api outage/i).first().click();
    await page.waitForTimeout(2200);
    await expect(page.getByText(/rca-2026-0001/i)).toBeVisible();
    await expect(page.getByText(/^completed$/i).first()).toBeVisible();
    await say(page, "**RCA‑2026‑0001, completed** — full evidence checklist, both action items verified, before it's allowed to say \"completed.\" Not a text box, a workflow.", { tag: 'RCA lifecycle', holdMs: 4800 });
  });

  await test.step('A recording flagged sensitive, blocking its RCA', async () => {
    await clear(page);
    await page.getByRole('link', { name: /^tickets$/i }).click();
    await page.waitForTimeout(1800);
    await page.getByText(/payroll app slow/i).first().click();
    await page.waitForTimeout(2200);
    await page.getByText(/^recordings$/i).first().click();
    await page.waitForTimeout(1800);
    await say(page, "This ticket's recording is flagged sensitive — consent disputed, so its AI summary was skipped. That's exactly what's blocking its RCA from moving forward.", { tag: 'Recordings', holdMs: 4200 });
  });

  await test.step('Reports: RCA and recording compliance', async () => {
    await clear(page);
    await page.getByRole('link', { name: /^reports$/i }).click();
    await page.waitForTimeout(2200);
  });
});
