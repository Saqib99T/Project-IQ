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

  await test.step('Tickets', async () => {
    await clear(page);
    await page.getByRole('link', { name: /tickets$/i }).click();
    await page.waitForTimeout(2200);
    await expect(page.getByText(/in progress/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "The portal's lightweight ticket view — the same tickets the standalone ITSM app manages, filterable right here without leaving the portal.", { tag: 'Tickets', holdMs: 4200 });
  });

  await test.step('Knowledge Base', async () => {
    await clear(page);
    // The Tickets page (ItsmLayout) has its own in-page tab bar with a
    // second "Knowledge Base" link — scope to the actual sidebar link.
    await page.locator('a.sidebar-link').filter({ hasText: /knowledge base/i }).click();
    await page.waitForTimeout(2200);
    await expect(page.getByPlaceholder(/search knowledge base/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "This tenant's own knowledge base — searchable right from the portal, same articles the chatbot and ITSM app draw from.", { tag: 'Knowledge Base', holdMs: 4200 });
  });
});
