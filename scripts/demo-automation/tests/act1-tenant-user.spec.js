// ACT 1 — Tenant User: chat widget, KB question, ticket creation, human handoff.
// Mirrors docs/full-app-demo-script.html Act 1. Self-narrating — see lib/annotate.js.
import { test, expect } from '@playwright/test';
import { loginWidget, pickProductIfPrompted } from '../lib/login.js';
import { say, clear } from '../lib/annotate.js';

// The chat widget is a small floating box on a deliberately blank "mockup
// host site" (there to prove it's embeddable) — recording at full-HD here
// would mostly show that empty backdrop. Size the viewport to the widget's
// own footprint instead, so it fills the frame like an actual app screen.
test.use({
  viewport: { width: 460, height: 700 },
  video: { mode: 'on', size: { width: 460, height: 700 } },
});

test('Act 1 — Tenant User asks for help', async ({ page }) => {
  await test.step('Sign in via the chat widget', async () => {
    await loginWidget(page, 'blue.bot@example.com');
    await pickProductIfPrompted(page, 'Project IQ');
    await expect(page.getByText(/hi blue bot/i)).toBeVisible({ timeout: 10_000 });
    await say(page, "This is the same chat surface an employee sees embedded in their intranet — signed in via **single sign-on**, not a separate password.", { tag: 'Act 1 · Tenant User' });
  });

  await test.step('Ask a KB-answerable question', async () => {
    const input = page.getByPlaceholder(/message/i);
    await input.fill('How do I connect to the VPN?');
    await input.press('Enter');
    // give the bot a moment to reply — this is an NLU round trip, not instant
    await page.waitForTimeout(5000);
    await say(page, "Most requests never need a human — **bot-first**, answered straight from the knowledge base. A ticket only opens when it's actually needed.", { tag: 'Bot-first' });
  });

  await test.step('Create a ticket from chat', async () => {
    await clear(page);
    await page.getByText(/^create ticket$/i).first().click();
    // The bot reply that opens this form is an NLU round trip — its latency
    // varies a lot by environment (a loaded/cold-started server can take well
    // over the ~2.8s this used to hardcode), so wait for the actual field
    // instead of guessing a fixed delay.
    const titleInput = page.locator('input[name="title"]');
    await titleInput.waitFor({ state: 'visible', timeout: 20_000 });

    // Each run creates a fresh ticket — no cleanup step reuses a prior one — so
    // give every run's title a distinct marker. Otherwise repeated demo runs
    // pile up visually-identical tickets with nothing to tell them apart.
    const runStamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await titleInput.fill(`Laptop reboots randomly during video calls (demo run ${runStamp})`);
    await page.locator('textarea[name="detail"]').fill('Started this week — happens roughly once a day, always during a Teams call. Fans spin up hard right before it happens.');
    await page.locator('select[name="category"]').selectOption({ label: 'Hardware' }).catch(() => {});
    await page.locator('select[name="priority"]').selectOption({ label: 'Medium' }).catch(() => {});
    await say(page, "A structured ticket — title, detail, category, priority — right from the chat, no separate portal to log into.", { tag: 'Ticket creation', holdMs: 3000 });

    await page.getByRole('button', { name: /^submit$/i }).click();
    await page.waitForTimeout(2200);
    // the form's Submit opens a review screen — this second click actually creates it
    await page.getByRole('button', { name: /yes, create it/i }).click();
    await page.waitForTimeout(3500);
  });

  await test.step('Ask for a human', async () => {
    await say(page, "This is the exact moment we'll pick up from **the other side of the screen** in Act 2 — the operator console.", { tag: 'Handoff' });
    await page.getByText(/talk to human/i).click();
    await page.waitForTimeout(3200);

    // Two branches depending on live operator availability at the moment of
    // the request — handle whichever one actually shows up:
    const consentBtn = page.getByRole('button', { name: /yes, i agree/i });
    const waitAnywayBtn = page.getByRole('button', { name: /wait in queue anyway/i });
    if (await consentBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await consentBtn.click();
    } else if (await waitAnywayBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await waitAnywayBtn.click();
    }
    await page.waitForTimeout(4500);
    await expect(page.getByText(/queue|connecting|wait|shortly/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
