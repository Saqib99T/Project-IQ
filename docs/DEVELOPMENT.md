# Development notes

## Build artifacts are not in git

Large, regenerable artifacts were removed from version control (they had bloated
the repo to ~1.6 GB). They are **not deleted** — just no longer tracked, and now
git-ignored. Here's how to get each one.

### Rasa model (`core/models/*.tar.gz`)

The trained NLU/dialogue model (~40 MB) is a build artifact.

- **Prod** retrains on the server, so it never used the git copy.
- **CI** doesn't need a trained model — the NLU tests validate the training
  *data* (`core/data/nlu.yml`, `domain.yml`), not a `.tar.gz`.
- **Local dev** is the only place that needs one. Two ways to get it:

  **Train it (no setup required):**
  ```bash
  cd core && rasa train
  ```

  **Or fetch the prebuilt one** from the `model-latest` Release:
  ```bash
  export RASA_MODEL_URL="https://github.com/Saqib99T/Project-IQ/releases/download/model-latest/model.tar.gz"
  export RASA_MODEL_SHA256="2fcfad382fb4f028856d1f9c408db52a5680711de98ad32206594cc36441d38c"
  python scripts/get_model.py
  ```
  **The repo is private**, so the script downloads via the `gh` CLI (install it
  and run `gh auth login` first). For a GitHub release URL it uses
  `gh release download` automatically; the raw-URL path is used only for public
  buckets. It verifies the SHA-256, never overwrites an existing model unless you
  pass `--force`, and writes atomically. See `scripts/get_model.py --help`.

  Rasa automatically loads the **newest** model in `core/models/`, so once one
  file is present (trained or fetched), the bot runs.

### Mobile app (`expo-app/ProjectIQ.apk`)

The Android build is published to **GitHub Releases**, not committed to git.

- **Build it:** `cd expo-app && eas build --platform android --profile production`
- **Download a built one:** from the repo's Releases page.

## Publishing artifacts (maintainers)

Use **`scripts/publish_release.sh`** — it picks the newest `core/models/*.tar.gz`,
uploads it as the stable asset `model.tar.gz` (+ `expo-app/ProjectIQ.apk` if
present) to a GitHub Release, and prints the `RASA_MODEL_URL` /
`RASA_MODEL_SHA256` to export. Dry-run by default:

```bash
scripts/publish_release.sh             # preview (shows sha256 + planned gh commands)
gh auth login                          # one-time, if not already
scripts/publish_release.sh --apply     # publish to tag model-latest
```

Doing it by hand instead:
1. **Model** — upload `core/models/<name>.tar.gz` as `model.tar.gz` on a Release
   (tag `model-latest`); note its `sha256sum` for `RASA_MODEL_SHA256` and point
   `RASA_MODEL_URL` at the asset.
2. **APK** — attach `ProjectIQ.apk` to the Release.

For private Release assets, the fetch script reads an optional bearer token from
`RASA_MODEL_TOKEN` (environment only — never hardcode it).

## Reclaiming git history (Phase 2 — not yet done)

Removing the files from tracking stops *new* clones/CI-checkouts from pulling
them, but the ~1.6 GB of blobs still live in history. To reclaim that, a
`git filter-repo` pass + force-push is required (rewrites history → everyone
re-clones). Run only as a deliberately scheduled step.
