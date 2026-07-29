import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 150_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,     // acts share tenants/tickets — keep sequential and readable
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    baseURL: 'http://localhost:8181',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // full-HD, matches a real monitor 1:1 — no letterboxing in the recording
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 15_000,
    // set SLOWMO=300 (ms) when running --headed to watch it live at a human
    // pace — each click/fill/type pauses that long before firing. 0 by
    // default so headless/CI runs stay fast.
    launchOptions: { slowMo: Number(process.env.SLOWMO || 0) },
  },
  outputDir: 'videos',
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // devices['Desktop Chrome'] carries its own (smaller) viewport, which
      // otherwise silently overrides the top-level one above — the video
      // canvas stayed 1920x1080 but the actual rendered content shrank to
      // fit the device's default, leaving the frame padded with black.
      // Reassert full-HD here, after the spread, so nothing shrinks it back.
      viewport: { width: 1920, height: 1080 },
    },
  }],
});
