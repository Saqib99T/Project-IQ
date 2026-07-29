# Demo automation

Playwright scripts that drive the *real* app end to end as each of the four demo
personas, plus two feature deep-dives — no mocking, no stubbed data. Companion to
`docs/full-app-demo-script.html` (the presenter runbook these scripts literally
implement) and `docs/full-app-demo-deck.html` (the audience-facing deck).

What this gives you:
1. **A rehearsal / regression check** — run it before the real meeting to catch
   anything broken.
2. **A recorded, narrated video per case** — `recordings/<case>.webm`, each with
   an on-screen comment bubble explaining what's happening, so it needs no
   voiceover. Useful as a fallback if live demo risk (network, a bad login) is a
   concern.
3. **A one-click browser dashboard** (`npm run dashboard`) — four pages
   (all cases, overall features, SLA/SLO, RCA), each playing its recordings
   and letting you trigger a fresh real run, from a web page, no terminal.
4. **An auto-playing version of the slide deck** — see the bottom of this file;
   unrelated to the app itself but part of the same "automatic demo" request.

## Prerequisites

- The local stack must be running: `itsm-service` (`docker compose up -d db redis
  minio api` from that repo) and this repo's admin server (`start_local.ps1`, or
  just `web/api/web_api.py` on :8181 if you don't need the chat bot's NLU).
- Demo data must be seeded (`scripts/seed/DEMO_DATA_SUMMARY.md`) — Act 3 and both
  flow scripts depend on the seeded "Payments API outage" incident, the 5-stage
  RCA pipeline, and the SLA/SLO demo data.
- The four demo accounts in `docs/full-app-demo-script.html` must exist and work
  (password `password` for all, per that doc).

## Install (one-time)

```bash
cd scripts/demo-automation
npm install
npm run install-browsers   # downloads a Chromium build for Playwright
```

## The six cases

| Command | Case | What it covers |
|---|---|---|
| `npm run act1` | Tenant User | Chat widget — KB question, ticket creation, human handoff |
| `npm run act2` | Tenant Operator | Claims the live chat, resolves it, works the same ticket at agent tier |
| `npm run act3` | Tenant Admin | Portal + ITSM admin, integrations, the RCA lifecycle — the centerpiece |
| `npm run act4` | Super Admin | Cross-tenant Organizations, tenant switcher, platform routing rules |
| `npm run sla` | SLA/OLA/UC + SLI/SLO | Agreements → targets → rules → coverage → at-risk board → ticket SLA panel → error budgets → SLI sources |
| `npm run rca` | RCA Governance | Policy builder → a completed RCA (evidence + verified actions) → recording-blocked RCAs |

```bash
npm run all    # every spec in tests/, in order. act2 depends on act1 having just
               # run (there needs to be a queued session and a ticket to open) —
               # run `all` rather than acts out of order for a clean pass.
npm run headed # any of the above with a visible browser window instead of headless
npm run report # opens the last run's HTML report (screenshots + traces on failure)
```

To watch a run live at a human pace instead of full-speed-headless, set `SLOWMO`
(milliseconds added before every click/fill):

```bash
# bash
SLOWMO=350 npx playwright test tests/act1-tenant-user.spec.js --headed --workers=1
# PowerShell
$env:SLOWMO=350; npx playwright test tests/act1-tenant-user.spec.js --headed --workers=1
```

Videos land under `videos/<test-name>/video.webm` (Playwright's default naming).
**`npx playwright test` wipes the `videos/` folder at the start of every run** —
so copy the one you want into `recordings/<case>.webm` immediately after, before
running anything else. The dashboard server (below) does this for you automatically.

## Browser dashboard (`npm run dashboard`)

```bash
npm run dashboard
# → Demo dashboard: http://localhost:4600
```

Four pages, all served by the same tiny server, cross-linked by a nav bar at the
top of each:

| Page | Shows |
|---|---|
| `/` or `/dashboard.html` | All six cases |
| `/features.html` | Just the four personas (Acts 1–4) — the overall-app demo |
| `/sla.html` | Just the SLA/OLA/UC + SLI/SLO reliability flow |
| `/rca.html` | Just the RCA Governance flow |

Every case card has its recording playing inline (`<video>`, seekable) and a
**Run** button. Checking "headed" opens the real Chromium window on this
machine so you can watch it drive itself; leaving it unchecked runs headless
and just updates the recording when done.

`server.js` is a small zero-dependency Node server (`node:http` +
`child_process`, no Express) — it spawns the real `npx playwright test <spec>`
for whichever case you clicked, and once it exits, copies the fresh video into
`recordings/<case>.webm` and deletes the temporary `videos/` folder, so every
`<video>` tag always reflects the latest run without you touching the
filesystem. `dashboard.js` + `dashboard.css` are shared across all four pages;
each page just sets `window.__DEMO_PAGE__ = { keys: [...] }` before loading the
shared script to pick which case cards it shows (`null` = all of them).

There's no way to execute Node/Playwright from a static page's own JavaScript —
a browser can't spawn OS processes — so this small server is the minimum needed
to make "click a button, watch it run" true rather than "click a button, get a
shell command to paste."

## The narrated flow scripts (`npm run sla`, `npm run rca`)

Both are self-narrating: `lib/annotate.js` injects an actual DOM overlay — a
dark comment bubble, **top-center**, with a mono tag label — into the page
before each step, so the explanation shows up in the recorded video itself, no
voiceover needed. Two small helpers do the work:

- `say(page, text, { tag, holdMs })` — shows a bubble (supports `**bold**`) and
  holds for `holdMs` (default ~4.8s — paced for someone reading along, not a
  fast-forward) before the next action.
- `highlight(locator, holdMs)` — a brief orange outline around whatever the
  bubble is talking about, so it's obvious on camera without a screenshot crop.
- `clear(page)` — removes the bubble. **Call this before any `getByText(...)`
  navigation lookup that might match the bubble's own words** — the RCA flow
  originally broke because its intro bubble said "RCA governance" and the next
  step's `getByText(/rca governance/i)` matched the bubble instead of the nav
  link. Prefer `getByRole('button'/'link', { name: ... })` over `getByText`
  for real navigation wherever the two could plausibly collide.

Reuse this pattern for any other feature you want a narrated walkthrough of —
two imports and a handful of `say()` calls around the existing specs' style.

## A note on rate limiting

Both backends rate-limit by IP, and repeatedly re-running these scripts (many
logins/page loads in quick succession) can trip that limiter faster than a real
user ever would. For **local dev only**, both limits have been raised well above
default in this environment:

- `common/app.config.local` → `[RATELIMIT]` section (web_api, port 8181)
- `itsm-service/.env` → `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_BURST` (port 8000)

If you see `"error":"rate_limited"` or `"Too many requests"` mid-run, that's this
limiter — wait ~30s and retry, it isn't a real bug. Don't raise these further in
anything other than a local/dev profile.

## Known quirks the scripts already work around

- **Clock-skew "not yet valid" tokens**: fixed at the source — both
  `common/iam_service.py` and `itsm-service/app/auth/jwks.py` now decode JWTs
  with a `leeway` so a few seconds of drift between this machine and the IAM
  server doesn't reject a freshly-minted token. If you ever see `"Invalid token:
  The token is not yet valid (iat)"` again, that fix regressed.
- **`waitForLoadState('networkidle')` never resolves** in this app — the widget
  and operator console keep a websocket open, so the page never truly idles.
  `lib/login.js` uses `'domcontentloaded'` + a short fixed pause instead. Don't
  reintroduce a `networkidle` wait anywhere in this suite.
- **Two confirmation steps in the chat widget** that are easy to miss: the
  ticket form's "Submit" opens a review screen (needs a second "Yes, Create It"
  click to actually create the ticket), and "Talk to Human" asks for consent
  ("Yes, I agree") — or, if no operator is marked Available, offers "Wait in
  queue anyway" instead. Act 1 handles both branches.
- **Session state accumulates** across repeated runs (old queue entries, old
  tickets) — Act 2 targets the "My Sessions" list by its real `href` pattern
  rather than by visible text, since a same-text queue entry and older sessions
  can otherwise make a text-based click ambiguous. Each `act1`/`all` run also
  leaves behind one more "Laptop reboots randomly during video calls" ticket on
  the Blue Team tenant — harmless, but if the tickets list gets noisy, it's safe
  to delete the extras (they're all obviously same-titled and recent).
- **A narration bubble can shadow a real locator** — see the `clear(page)` note
  above. If a new narrated flow fails with a "strict mode violation: resolved to
  2 elements" pointing at your own bubble text, that's why.

## Recording &amp; playback settings

- Resolution is full-HD (`1920×1080`, `playwright.config.js`) for every full-page
  app (Acts 2–4, `sla`, `rca`) so recordings match a real monitor 1:1 with no
  letterboxing. **Act 1 is the one exception** — the chat widget is a small
  floating box on a deliberately blank "mockup host site" (there to prove it's
  embeddable), so full-HD there would mostly show empty backdrop. It overrides
  to a tight `460×700` viewport via `test.use({...})` at the top of
  `act1-tenant-user.spec.js`, sized to the widget's own footprint.
- **Never spread `devices['Desktop Chrome']` into a project's `use` without
  re-asserting viewport afterward** — that device descriptor carries its own
  (smaller) viewport, which silently overrides whatever you set at the
  top-level `use`. This is exactly what caused the first version of the
  full-HD recordings to show black letterboxing: the video *canvas* stayed
  1920×1080 but the actual rendered content shrank to the device's default.
  `playwright.config.js`'s `projects` entry re-sets `viewport` after the
  spread specifically to prevent this regressing.
- The bubble's own CSS width is responsive (`min(720px, calc(100vw - 32px))`)
  so it never overflows a narrow viewport like Act 1's — don't hard-code a
  fixed pixel width back in if you touch `lib/annotate.js`.
- Default per-step hold is ~4.8s (`lib/annotate.js`) — slow enough to read the
  bubble before the next action fires. Tune `holdMs` per-call if a specific step
  needs more or less time.

## Auto-playing slide deck

`docs/full-app-demo-deck.html` (and the published artifact) has a play/pause
button and a `P` keyboard shortcut for hands-free auto-advance. Open it with
`?autoplay=1` in the URL to start it running unattended — useful for a kiosk
screen or if you want to screen-record the deck itself rather than the live app.
