#!/usr/bin/env python3
"""
Fetch (or train) the Rasa model — models are no longer stored in git.

Why: Rasa model tarballs are large, regenerable build artifacts (~40 MB each)
and were removed from version control. Prod retrains on-box and CI doesn't need
a trained model, so this is purely a convenience for a fresh local checkout.

Usage
-----
    python scripts/get_model.py                 # fetch from $RASA_MODEL_URL, else guide to train
    python scripts/get_model.py --force         # re-download even if a model is already present
    python scripts/get_model.py --url <https…>  # one-off URL override

Configure the source once (when the Release/bucket exists):
    export RASA_MODEL_URL="https://github.com/saqibgm/Project-IQ/releases/download/model-latest/model.tar.gz"
    # optional integrity check (recommended):
    export RASA_MODEL_SHA256="<sha256 hex of the tarball>"
    # optional auth for a private asset (never hardcode — read from env only):
    export RASA_MODEL_TOKEN="<bearer token>"

Safety
------
- HTTPS is required (use --allow-insecure to override, discouraged).
- The download is streamed to a temp file, verified to be a real .tar.gz
  (and SHA-256-checked when RASA_MODEL_SHA256 is set), and only then moved
  into core/models/ — a failed/partial/corrupt download never lands.
- An existing model is never overwritten unless --force is passed.
- The auth token is read from the environment only and never logged.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

# https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>
_GH_RELEASE_RE = re.compile(
    r"^https://github\.com/(?P<repo>[^/]+/[^/]+)/releases/download/(?P<tag>[^/]+)/(?P<asset>[^/]+)$"
)

REPO_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = REPO_ROOT / "core" / "models"


def _existing_models() -> list[Path]:
    return sorted(MODELS_DIR.glob("*.tar.gz"))


def _fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _guide_to_train() -> None:
    print(
        "No RASA_MODEL_URL set and no model present.\n"
        "Train one locally instead (a few minutes):\n"
        "    cd core && rasa train\n"
        "or set RASA_MODEL_URL to a Release/bucket asset and re-run this script.",
        file=sys.stderr,
    )
    sys.exit(1)


def _download(url: str, dest: Path, token: str | None) -> None:
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")  # value never printed
    # Stream in chunks so a large asset never sits fully in memory.
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310 (https enforced by caller)
        if resp.status != 200:
            _fail(f"download returned HTTP {resp.status}")
        with open(dest, "wb") as fh:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)


def _download_via_gh(repo: str, tag: str, asset: str, dest: Path) -> None:
    """Download a release asset with the gh CLI (handles private-repo auth).

    GitHub does not serve private release assets over the plain
    releases/download/ URL (404 even with a bearer token), so for a GitHub
    release we shell out to gh, which resolves the asset via the API.
    """
    dest.unlink(missing_ok=True)  # gh refuses to overwrite without --clobber
    try:
        subprocess.run(
            ["gh", "release", "download", tag, "--repo", repo,
             "--pattern", asset, "--output", str(dest), "--clobber"],
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as exc:
        _fail(f"gh release download failed: {exc.stderr.strip() or exc}")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch the Rasa model (kept out of git).")
    ap.add_argument("--url", default=os.environ.get("RASA_MODEL_URL", "").strip())
    ap.add_argument("--force", action="store_true", help="re-download even if a model exists")
    ap.add_argument("--allow-insecure", action="store_true", help="permit a non-HTTPS URL (discouraged)")
    args = ap.parse_args()

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    existing = _existing_models()
    if existing and not args.force:
        print(f"OK: model already present ({existing[-1].name}); skipping. Use --force to re-download.")
        return

    url = args.url
    if not url:
        _guide_to_train()

    if not url.lower().startswith("https://") and not args.allow_insecure:
        _fail(f"refusing non-HTTPS URL: {url!r} (pass --allow-insecure to override)")

    token = os.environ.get("RASA_MODEL_TOKEN") or None
    expected_sha = (os.environ.get("RASA_MODEL_SHA256") or "").strip().lower() or None

    # Download to a temp file inside MODELS_DIR (same filesystem → atomic rename).
    fd, tmp_name = tempfile.mkstemp(prefix=".model-download-", suffix=".tar.gz", dir=MODELS_DIR)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        gh_match = _GH_RELEASE_RE.match(url)
        if gh_match and shutil.which("gh"):
            # GitHub release (works for private repos via gh's authenticated API).
            m = gh_match.groupdict()
            print(f"Downloading {m['asset']} from {m['repo']} release {m['tag']} via gh ...")
            _download_via_gh(m["repo"], m["tag"], m["asset"], tmp)
        else:
            if gh_match:
                print("note: gh CLI not found — trying a direct download "
                      "(works only if the repo/asset is public).")
            print(f"Downloading model from {url} ...")
            _download(url, tmp, token)

        if tmp.stat().st_size == 0:
            _fail("downloaded file is empty")
        if not tarfile.is_tarfile(tmp):
            _fail("downloaded file is not a valid .tar.gz (wrong URL or corrupt asset)")
        if expected_sha:
            actual = _sha256(tmp)
            if actual != expected_sha:
                _fail(f"SHA-256 mismatch — expected {expected_sha}, got {actual}")
            print("SHA-256 verified")

        # Derive a stable filename from the URL; ensure .tar.gz suffix.
        name = url.rstrip("/").split("/")[-1] or "fetched-model.tar.gz"
        if not name.endswith(".tar.gz"):
            name = "fetched-model.tar.gz"
        final = MODELS_DIR / name
        os.replace(tmp, final)  # atomic; tmp no longer exists
        print(f"OK: model ready: {final.relative_to(REPO_ROOT)}")
        print("  Rasa loads the newest model in core/models/ automatically.")
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
