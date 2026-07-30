// ACT 3 — Tenant Admin: a full tour of the portal admin — everything a
// tenant owns and can self-serve, pinned hard to just this org. Mirrors
// docs/full-app-demo-script.html Act 3. The standalone ITSM app (Service
// Catalog, On-Call/SRE, Reliability, RCA governance, tickets) is its own
// act — see act3b-itsm-admin.spec.js. Self-narrating — see lib/annotate.js.
import { test, expect } from '@playwright/test';
import { loginPortal } from '../lib/login.js';
import { say, highlight, clear } from '../lib/annotate.js';

test('Act 3 — Tenant Admin runs the portal', async ({ page }) => {
  await test.step('Sign in and land on Overview', async () => {
    await loginPortal(page, 'blue@example.com');
    await expect(page).toHaveURL(/\/portal\/admin/, { timeout: 15_000 });
    await say(page, "The **Tenant Admin** — everything a tenant owns and can self-serve, pinned hard to just this org.", { tag: 'Act 3 · Tenant Admin' });
    await expect(page.getByText(/live system snapshot/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "Overview: a live snapshot — waiting, active sessions, operators online, resolved today.", { tag: 'Overview', holdMs: 3600 });
  });

  await test.step('Analytics', async () => {
    await clear(page);
    // Sidebar links render an emoji icon glued directly to the label with no
    // separating space (JSX collapses the whitespace between them), so the
    // accessible name is e.g. "📈Analytics" — anchor only the end, not the start.
    await page.getByRole('link', { name: /analytics$/i }).click();
    await page.waitForTimeout(2000);
  });

  await test.step('History', async () => {
    await page.getByRole('link', { name: /history$/i }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/completed sessions/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "Every past session — filterable by status, operator, and date range, exportable to CSV.", { tag: 'History', holdMs: 3600 });
  });

  await test.step('Live Monitor', async () => {
    await clear(page);
    await page.getByRole('link', { name: /live monitor$/i }).click();
    await page.waitForTimeout(2200);
    await expect(page.getByText(/waiting queue/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "The queue and every active conversation, live — auto-refreshing, with a one-click reassign.", { tag: 'Live Monitor', holdMs: 3600 });
  });

  await test.step('Alerts', async () => {
    await clear(page);
    await page.getByRole('link', { name: /alerts$/i }).click();
    await page.waitForTimeout(2000);
  });

  await test.step('Users', async () => {
    await page.getByRole('link', { name: /users$/i }).click();
    await page.waitForTimeout(2500);
    await say(page, "Org membership and roles — invite, promote, revoke, all scoped to this tenant only.", { tag: 'Users', holdMs: 3600 });
  });

  await test.step('Integrations marketplace', async () => {
    await clear(page);
    await page.getByRole('link', { name: /integrations/i }).click();
    await page.waitForTimeout(2200);
    await expect(page.getByText(/marketplace/i).first()).toBeVisible();
    await say(page, "This used to be **platform-only**. Tenant admins can wire their own Teams/webhook integrations now, scoped automatically to just their org.", { tag: 'Integrations', holdMs: 4200 });
  });
});
