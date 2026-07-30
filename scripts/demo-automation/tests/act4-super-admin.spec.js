// ACT 4 — Super Admin: cross-tenant Organizations list, a tour of the
// Platform-only tools (config, knowledge base, bot studio, themes,
// observability, diagnostics, inspector), and the tenant switcher. Mirrors
// docs/full-app-demo-script.html Act 4. Direct route navigation is used for
// the Platform pages — the sidebar's collapsible group scrolls out of view
// and a plain text click there is flaky; the routes themselves are stable.
// Self-narrating — see lib/annotate.js.
import { test, expect } from '@playwright/test';
import { loginPortal } from '../lib/login.js';
import { say, highlight, clear } from '../lib/annotate.js';

test('Act 4 — Super Admin runs the platform', async ({ page }) => {
  await test.step('Sign in as the platform admin', async () => {
    await loginPortal(page, 'projectiq-admin@99technologies.com');
    await expect(page).toHaveURL(/\/portal\/admin/, { timeout: 15_000 });
    // the tenant switcher (a native <select> containing "All tenants") only
    // renders for a platform identity
    const switcher = page.getByRole('combobox').first();
    await expect(switcher).toBeVisible();
    await highlight(switcher, 1200);
    await say(page, "One extra sidebar group appears only for this login: **Platform**. Everything else a tenant admin already had, this identity bypasses into as well.", { tag: 'Act 4 · Super Admin', holdMs: 4800 });
  });

  await test.step('Cross-tenant Organizations list', async () => {
    await page.goto('/portal/admin/orgs');
    await page.waitForTimeout(2200);
    await expect(page.getByText(/waiting|assigned/i).first()).toBeVisible();
    await say(page, "Every tenant, side by side — read-only stats, and deliberately **no \"create org\" button**. Provisioning is a signed IAM webhook, not a click here.", { tag: 'Organizations', holdMs: 4800 });
  });

  await test.step('Platform Knowledge Base', async () => {
    await clear(page);
    await page.goto('/portal/admin/kb');
    await page.waitForTimeout(3500);
    await expect(page.getByText(/total articles/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "The platform-wide KB cache — article count, semantic model, and a live search tester with a full score breakdown.", { tag: 'Knowledge Base', holdMs: 4200 });
  });

  await test.step('Bot Studio', async () => {
    await clear(page);
    await page.goto('/portal/admin/studio');
    await page.waitForTimeout(2000);
    await expect(page.getByText(/training files/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "NLU training data lives here — domain, pipeline config, and the intent list — edited and retrained without touching a terminal.", { tag: 'Bot Studio', holdMs: 4200 });
  });

  await test.step('Themes', async () => {
    await clear(page);
    await page.goto('/portal/admin/themes');
    await page.waitForTimeout(2000);
    await expect(page.getByText(/widget colour themes/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "Widget colour themes, ready to assign per tenant — brand the chat experience without a redeploy.", { tag: 'Themes' });
  });

  await test.step('Observability', async () => {
    await clear(page);
    await page.goto('/portal/admin/observability');
    await page.waitForTimeout(2200);
    await expect(page.getByText(/service health and system metrics/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "Live service health and system metrics — CPU, memory, disk, response time — across every core process.", { tag: 'Observability', holdMs: 4200 });
  });

  await test.step('Diagnostics', async () => {
    await clear(page);
    await page.goto('/portal/admin/diagnostics');
    await page.waitForTimeout(2200);
    await expect(page.getByText(/server services, container states/i)).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Inspector', async () => {
    await clear(page);
    await page.goto('/portal/admin/inspector');
    await page.waitForTimeout(2200);
    await expect(page.getByText(/inspect conversations/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "Every conversation, inspectable down to the slot and intent — plus a standalone NLU tester for trying a message without a real session.", { tag: 'Inspector', holdMs: 4200 });
  });

  await test.step('Tenant switcher — flip to Green Team', async () => {
    await clear(page);
    await page.goto('/portal/admin');
    await page.waitForTimeout(1800);
    const switcher = page.getByRole('combobox').first();
    const options = await switcher.locator('option').allTextContents();
    const greenLabel = options.find((o) => /green/i.test(o));
    await highlight(switcher, 1000);
    await say(page, "Flipping the tenant switcher to **Green Team** — everything reloads scoped to a completely different org. Row-level security, not just a UI filter.", { tag: 'Tenant switcher', holdMs: 4200 });
    await switcher.selectOption({ label: greenLabel });
    await page.waitForTimeout(2500);
  });
});
