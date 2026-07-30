// Shared Keycloak login helpers — drive the real 99-iam SSO flow (no mocking).
// All three surfaces (/portal, /itsm, /bot) redirect to the same Keycloak
// instance/realm/client; only how you *get to* that redirect differs.
import { injectFakeCursor } from './cursor.js';

const DEMO_PASSWORD = 'password';

/** Drives the Keycloak username -> continue -> password -> login steps once
 * the browser has already landed on id.dev.iam.99technologies.com. */
async function completeKeycloakForm(page, email, password) {
  await page.waitForURL(/id\.dev\.iam\.99technologies\.com/, { timeout: 15_000 });
  await page.locator('#username').fill(email);
  await page.locator('#kc-continue, button[type=submit], input[type=submit]').first().click();

  await page.locator('#password').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#password').fill(password);
  await page.locator('#kc-login, button[type=submit]:visible, input[type=submit]:visible').first().click();

  // NOTE: don't wait for 'networkidle' anywhere in this app — the widget/portal
  // keep a websocket open (chat, live queue) so the page never truly idles and
  // the wait just eats the whole test timeout. 'domcontentloaded' + a short
  // settle pause is the reliable signal here.
  //
  // "back on our app" means "no longer on Keycloak's hostname" — not
  // hardcoded to 'localhost', since DEMO_BASE_URL can point this at the live
  // prod host instead (see playwright.config.js).
  await page.waitForURL((url) => url.hostname !== 'id.dev.iam.99technologies.com', { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1200);
}

/** Waits for one of three outcomes after landing on a surface: the Keycloak
 * redirect already happened, a "sign in" trigger is showing, or (an active
 * SSO session from an earlier login in this same browser context carried us
 * straight through) neither — already authenticated, nothing to do. */
async function raceLoginOutcomes(page, signInTrigger) {
  await Promise.race([
    page.waitForURL(/id\.dev\.iam\.99technologies\.com/, { timeout: 12_000 }),
    signInTrigger.waitFor({ state: 'visible', timeout: 12_000 }),
  ]).catch(() => {});
}

/** A silent SSO check (prompt=none) can transiently bounce the page through
 * Keycloak's URL before landing back on the sign-in trigger (error=
 * login_required in the fragment) — over local's near-zero latency that
 * bounce completes before raceLoginOutcomes's caller ever observes it; over
 * a real network round trip (the "live" target) a page.url() snapshot can
 * catch it mid-transit and wrongly conclude the real login form is showing,
 * where it then waits forever for a #username that will never appear (the
 * actual sign-in trigger was never clicked). Confirming the form field is
 * actually there — not just that the URL once matched — is what makes this
 * safe under either latency. */
async function onKeycloakLoginForm(page) {
  return page.locator('#username').waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
}

/** /itsm redirects straight to Keycloak when signed out — no trigger to click.
 * If a Keycloak session already exists in this browser context (e.g. from an
 * earlier loginPortal call for the same person), it completes silently and
 * lands straight in the app — detect that and skip the form entirely. */
export async function loginItsm(page, email, password = DEMO_PASSWORD) {
  await injectFakeCursor(page);
  await page.goto('/itsm');
  await raceLoginOutcomes(page, page.getByText(/sign in/i));
  if (await onKeycloakLoginForm(page)) {
    await completeKeycloakForm(page, email, password);
  }
}

/** /portal shows a "Sign in with Project IQ" card first — unless a session
 * already exists, in which case it goes straight to /portal/admin etc. */
export async function loginPortal(page, email, password = DEMO_PASSWORD) {
  await injectFakeCursor(page);
  await page.goto('/portal');
  const signInBtn = page.getByText(/sign in with project iq/i);
  await raceLoginOutcomes(page, signInBtn);
  if (await onKeycloakLoginForm(page)) {
    await completeKeycloakForm(page, email, password);
    return;
  }
  if (await signInBtn.isVisible().catch(() => false)) {
    await signInBtn.click();
    await completeKeycloakForm(page, email, password);
  }
}

/** /bot is a floating widget: open it, open the login prompt, then IAM sign-in. */
export async function loginWidget(page, email, password = DEMO_PASSWORD) {
  await injectFakeCursor(page);
  await page.goto('/bot');
  await openWidget(page);
  await page.locator('button[title="Login"]').click();
  await page.getByText(/sign in with iam/i).first().click();
  await completeKeycloakForm(page, email, password);
  await openWidget(page); // the widget starts closed again after the SSO round-trip
}

/** Picks a product in the widget's gate dropdown if one is showing (accounts
 * subscribed to multiple products land here before they can chat). */
export async function pickProductIfPrompted(page, label = 'Project IQ') {
  const picker = page.getByRole('combobox').filter({ hasText: /select a product/i })
    .or(page.locator('select').filter({ has: page.locator(`option:has-text("${label}")`) }));
  if (await picker.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await picker.first().selectOption({ label });
    await page.waitForTimeout(1000);
  }
}

/** Opens the chat widget bubble if it isn't already expanded. */
export async function openWidget(page) {
  const launcher = page.locator('.cursor-pointer').last();
  // isVisible() is an instantaneous check, not a wait — against a target
  // with real network latency (e.g. the "live" prod target) the launcher
  // can simply not have rendered yet at this exact instant, silently
  // skipping the click and leaving the widget panel collapsed for the rest
  // of the flow. waitFor() polls instead, so slower page settles still work.
  const appeared = await launcher.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  if (appeared) {
    await launcher.click();
    await page.waitForTimeout(600);
  }
}

/** The backend occasionally rejects a token in the first second or two after
 * minting it ("Invalid token: The token is not yet valid (iat)") — a small
 * clock-skew tolerance issue between this machine and the IAM server, not an
 * app bug. A real user would just refresh; do the same here. */
export async function retryOnClockSkew(page, { attempts = 3, waitMs = 2500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const skewError = await page.getByText(/not yet valid|invalid token/i).first().isVisible().catch(() => false);
    if (!skewError) return;
    await page.waitForTimeout(waitMs);
    await page.reload();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }
}

export { DEMO_PASSWORD };
