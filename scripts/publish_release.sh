#!/usr/bin/env bash
#
# Publish the build artifacts (Rasa model + Android APK) to a GitHub Release,
# so a fresh checkout can fetch them (scripts/get_model.py) instead of carrying
# 100+ MB binaries in git.
#
# DRY RUN by default — prints the plan + the env vars to set. Pass --apply to
# actually create/update the release (requires `gh auth login` first).
#
# Usage:
#   scripts/publish_release.sh [TAG] [--apply]
#   TAG defaults to "model-latest" (the tag scripts/get_model.py documents).
#
# It uploads:
#   - the NEWEST core/models/*.tar.gz, as the stable asset name "model.tar.gz"
#     (so RASA_MODEL_URL stays constant across rebuilds)
#   - expo-app/ProjectIQ.apk (if present)
#
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GH_REPO="${GH_REPO:-saqibgm/Project-IQ}"
TAG="model-latest"; APPLY=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) TAG="$a" ;;
  esac
done

# Newest trained model.
MODEL_SRC="$(ls -t core/models/*.tar.gz 2>/dev/null | head -1 || true)"
[ -n "$MODEL_SRC" ] || { echo "ERROR: no model in core/models/*.tar.gz — train one (cd core && rasa train)"; exit 1; }
APK="expo-app/ProjectIQ.apk"

MODEL_SHA="$(sha256sum "$MODEL_SRC" | awk '{print $1}')"
echo "[publish] repo:        $GH_REPO"
echo "[publish] tag:         $TAG"
echo "[publish] model src:   $MODEL_SRC  ->  asset model.tar.gz"
echo "[publish] model sha256:$MODEL_SHA"
if [ -f "$APK" ]; then
  echo "[publish] apk:         $APK ($(du -h "$APK" | cut -f1)), sha256 $(sha256sum "$APK" | awk '{print $1}')"
else
  echo "[publish] apk:         (none — skipping)"
fi

MODEL_URL="https://github.com/$GH_REPO/releases/download/$TAG/model.tar.gz"
echo
echo "After publishing, set these for scripts/get_model.py:"
echo "  export RASA_MODEL_URL=\"$MODEL_URL\""
echo "  export RASA_MODEL_SHA256=\"$MODEL_SHA\""
echo

# Stable-named copy for upload.
STAGED="$(mktemp -d)/model.tar.gz"
ASSETS=( "$STAGED" )
[ -f "$APK" ] && ASSETS+=( "$APK" )

if [ "$APPLY" -ne 1 ]; then
  echo "DRY RUN — would run:"
  echo "  cp '$MODEL_SRC' '$STAGED'"
  echo "  gh release view '$TAG' >/dev/null 2>&1 \\"
  echo "    && gh release upload '$TAG' ${ASSETS[*]} --clobber --repo '$GH_REPO' \\"
  echo "    || gh release create '$TAG' ${ASSETS[*]} --repo '$GH_REPO' --title 'Project IQ artifacts ($TAG)' --notes 'Rasa model + Android APK. Model sha256: $MODEL_SHA'"
  echo
  echo "Re-run with --apply to publish (needs: gh auth login)."
  exit 0
fi

command -v gh >/dev/null || { echo "ERROR: gh CLI not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: not logged in — run: gh auth login"; exit 1; }

cp "$MODEL_SRC" "$STAGED"
if gh release view "$TAG" --repo "$GH_REPO" >/dev/null 2>&1; then
  echo "[publish] release $TAG exists — uploading assets (--clobber)"
  gh release upload "$TAG" "${ASSETS[@]}" --clobber --repo "$GH_REPO"
else
  echo "[publish] creating release $TAG"
  gh release create "$TAG" "${ASSETS[@]}" --repo "$GH_REPO" \
    --title "Project IQ artifacts ($TAG)" \
    --notes "Rasa model + Android APK. Model sha256: \`$MODEL_SHA\`"
fi
echo "[publish] done. Asset URL: $MODEL_URL"
