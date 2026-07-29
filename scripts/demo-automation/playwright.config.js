import { defineConfig, devices } from '@playwright/test';

// A full 1920x1080 *viewport* means the actual browser window (viewport +
// tab/title-bar chrome) needs more vertical screen space than most monitors'
// actual working area (screen height minus taskbar) in headed mode, so the
// window spills off the bottom of the screen. Measured directly on a common
// 1920x1080-at-125%-scaling laptop (a very common Windows default): working
// area is 1536x816, and a 1440x810 viewport already produced an 882px-tall
// window — still 66px too tall. 1200x675 measured at 1216x764, comfortably
// under 816 with margin to spare, while staying a clean, standard 16:9 ratio.
const FULL_PAGE_VIEWPORT = { width: 1200, height: 675 };

export default defineConfig({
  testDir: './tests',
  timeout: 150_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,     // acts share tenants/tickets — keep sequential and readable
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    // DEMO_BASE_URL lets a run target the live prod app instead of this
    // machine's own local stack — the browser still runs right here (that's
    // what makes it reliable: no remote tunnel, no remote Node version
    // mismatch), it just drives a different URL. Verified: Keycloak's
    // registered redirect_uri allows the prod origin too, so login works
    // identically either way.
    baseURL: process.env.DEMO_BASE_URL || 'http://localhost:8181',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: { mode: 'on', size: FULL_PAGE_VIEWPORT },
    viewport: FULL_PAGE_VIEWPORT,
    actionTimeout: 15_000,
    launchOptions: {
      // set SLOWMO=300 (ms) when running --headed to watch it live at a human
      // pace — each click/fill/type pauses that long before firing. 0 by
      // default so headless/CI runs stay fast.
      slowMo: Number(process.env.SLOWMO || 0),
      // pin the headed window to the screen's top-left corner — without
      // this, Chromium can restore its last position from a previous run,
      // which may sit partly or fully off-screen on a different monitor
      // setup.
      args: ['--window-position=0,0'],
    },
  },
  outputDir: 'videos',
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // devices['Desktop Chrome'] carries its own (smaller) viewport, which
      // otherwise silently overrides the top-level one above — the video
      // canvas stayed a different size than the actual rendered content,
      // leaving the frame padded with black. Reassert the real viewport
      // here, after the spread, so nothing shrinks it back.
      viewport: FULL_PAGE_VIEWPORT,
    },
  }],
});
