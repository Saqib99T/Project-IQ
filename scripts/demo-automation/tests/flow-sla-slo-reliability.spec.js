// FLOW — SLA/OLA/UC ticket-SLA engine, end to end, then the separate SLI/SLO
// error-budget reliability layer. Self-narrating: a comment bubble in the
// bottom-left corner explains what's on screen at each step, so the recorded
// .webm needs no voiceover. Logs in once as the Tenant Admin (blue@example.com)
// — everything here lives under ITSM Administration.
import { test, expect } from '@playwright/test';
import { loginItsm } from '../lib/login.js';
import { say, highlight, clear } from '../lib/annotate.js';

test('Flow — SLA/OLA/UC and SLI/SLO reliability, narrated', async ({ page }) => {
  await test.step('Sign in as Tenant Admin', async () => {
    await loginItsm(page, 'blue@example.com');
    await page.waitForTimeout(1200);
    await say(page, "We're signed in as the **Tenant Admin** — SLA and reliability configuration both live under ITSM Administration.", { tag: 'Tenant Admin' });
  });

  await test.step('Open SLA / OLA / UC', async () => {
    await page.getByText(/administration/i).first().click();
    await page.waitForTimeout(1000);
    await page.getByText(/^service catalog$/i).click();
    await page.waitForTimeout(700);
    const link = page.getByText(/sla \/ ola \/ uc/i);
    await highlight(link, 800);
    await link.click();
    await page.waitForTimeout(1200);
    await say(page, "Three agreements, three kinds: **SLA** (customer-facing), **OLA** (internal team), **UC** (vendor contract) — the same object, chainable so a breach can be traced to whoever actually missed it.", { tag: 'SLA / OLA / UC · Agreements' });
  });

  await test.step('Targets — per-metric, versioned', async () => {
    await page.getByText(/standard support sla/i).first().click();
    await page.waitForTimeout(1200);
    await say(page, "**Targets** are per-metric: first response in 60 minutes, resolution in 480 — each independently versioned, so editing this later never rewrites a ticket's already-running clock.", { tag: 'Targets' });
  });

  await test.step('Rules — priority-ordered matching', async () => {
    await page.getByText(/^rules$/i).click();
    await page.waitForTimeout(1200);
    await say(page, "**Matching rules**, first match wins: critical-priority tickets get the Premium SLA; everything else falls through to Standard Support.", { tag: 'Rules' });
  });

  await test.step('Coverage windows', async () => {
    await page.getByText(/^coverage$/i).click();
    await page.waitForTimeout(1200);
    await say(page, "**Coverage windows** are named calendars — 24×7, business hours, or (not shown here) a follow-the-sun union of several regional windows. Clocks pause outside their window.", { tag: 'Coverage' });
  });

  await test.step('The at-risk live board', async () => {
    await page.getByText(/at-risk/i).click();
    await page.waitForTimeout(1200);
    const stats = page.locator('text=/AT RISK/i').first();
    await highlight(stats, 1200);
    await say(page, "The live compliance board, computed from real tickets right now: 13 at risk, 1 already breached, 50% compliance this period.", { tag: 'At-risk' });
  });

  await test.step('A real ticket’s SLA panel', async () => {
    await clear(page);
    await page.getByRole('link', { name: /^tickets$/i }).click();
    await page.waitForTimeout(1200);
    await page.getByText(/office vpn down/i).first().click();
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(500);
    const slaCard = page.getByText(/^sla$/i).first();
    await highlight(slaCard, 1000);
    await say(page, "Every ticket carries this panel live: this one's resolution target has actually breached — and a manager can **override the SLA** right here, with the reason captured in ticket history.", { tag: 'Ticket SLA panel' });
  });

  await test.step('Reliability (SLO) — a different layer entirely', async () => {
    await clear(page);
    await page.getByText(/administration/i).first().click();
    await page.waitForTimeout(1000);
    await page.getByText(/on-call & sre/i).click();
    await page.waitForTimeout(600);
    await page.getByText(/reliability/i).click();
    await page.waitForTimeout(1200);
    await say(page, "This is deliberately **separate** from the ticket-SLA engine above: a ticket SLA measures support timeliness. An SLO measures service reliability, fed by telemetry.", { tag: 'Reliability (SLO)' });
  });

  await test.step('Error budget — the seeded story', async () => {
    const paymentsCard = page.getByText(/payments api availability/i);
    await highlight(paymentsCard, 1000);
    await say(page, "**Payments API**: SLI 100%, target 99.9% — meeting, full error budget remaining. **Web Platform**: SLI 98% against a 99.5% target — at risk, budget nearly gone.", { tag: 'Error budget' });
  });

  await test.step('SLOs — the objective definition', async () => {
    await page.getByText(/^slos$/i).click();
    await page.waitForTimeout(1200);
    await say(page, "Each SLO ties one **SLI source** to a target percentage over a rolling window, plus fast/slow burn-rate rules — and yes, those “simulate healthy / simulate outage” buttons really do drive the burn-rate math live.", { tag: 'SLOs' });
  });

  await test.step('SLI sources — where the number comes from', async () => {
    await page.getByText(/sli sources/i).click();
    await page.waitForTimeout(1200);
    await say(page, "SLI sources: an **internal metric** needs no external monitor at all — a free-win demo path — or wire up Prometheus, Datadog, an uptime probe, or a signed push API.", { tag: 'SLI Sources', holdMs: 5200 });
  });
});
