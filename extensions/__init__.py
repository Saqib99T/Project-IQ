"""Extension registry — discovers every plugin under `extensions/<name>/` and
exposes it by its manifest id.

## Folder convention for a new extension

    extensions/<name>/
        __init__.py     required, empty — makes it a package the scanner sees
        extension.py    required — a module-level `EXTENSION = SomeExtension()`
                         instance (manifest + test/run/push, per extensions/base.py)
        service.py       optional — the extension's own API client / business
                         logic, if it has any beyond what fits in extension.py.
                         Keep it here, not in action_server/ or web/api/ — an
                         extension's logic must live inside its own folder so
                         the folder is genuinely self-contained (copy it
                         elsewhere and it still works, given extensions/base.py).
        routes.py        optional — a Flask `Blueprint` as module-level `bp`,
                         ONLY if the extension needs HTTP endpoints the generic
                         install/test/run/push surface (bp_extensions.py) can't
                         express — e.g. an OAuth redirect callback or an inbound
                         webhook receiver that must live at a fixed URL.

Discovery is a directory scan, not a hand-maintained list: adding extension
#N means adding a new folder here, not editing this file, register.py, or any
other central registration point — `register_blueprints()` in
web/api/blueprints/register.py pulls in every extension's `routes.py`
automatically via `list_route_blueprints()` below. A extension that fails to
import (missing optional dependency, bad config at import time) is skipped
with a warning rather than taking the whole registry down — one broken
plugin should never break the others.
"""
import importlib
import logging
import pkgutil

logger = logging.getLogger(__name__)

_REGISTRY: dict = {}
_ROUTE_BLUEPRINTS: list = []
_loaded = False


def _discover() -> None:
    global _loaded
    if _loaded:
        return
    import extensions as _pkg
    for _, name, is_pkg in pkgutil.iter_modules(_pkg.__path__):
        if not is_pkg:
            continue

        try:
            mod = importlib.import_module(f"extensions.{name}.extension")
        except Exception as e:
            logger.warning("[Extensions] skipping '%s': %s", name, e)
            continue
        ext = getattr(mod, "EXTENSION", None)
        if ext is None:
            logger.warning("[Extensions] '%s' has no module-level EXTENSION instance", name)
            continue
        _REGISTRY[ext.manifest.id] = ext

        # routes.py is optional — most extensions have no HTTP surface of
        # their own and are driven entirely through bp_extensions.py.
        try:
            routes_mod = importlib.import_module(f"extensions.{name}.routes")
        except ModuleNotFoundError:
            pass
        except Exception as e:
            logger.warning("[Extensions] '%s' has a routes.py but it failed to import: %s", name, e)
        else:
            bp = getattr(routes_mod, "bp", None)
            if bp is not None:
                _ROUTE_BLUEPRINTS.append(bp)
            else:
                logger.warning("[Extensions] '%s/routes.py' has no module-level `bp` Blueprint", name)

    _loaded = True
    logger.info("[Extensions] discovered %d extension(s), %d route blueprint(s): %s",
                len(_REGISTRY), len(_ROUTE_BLUEPRINTS), sorted(_REGISTRY))


def list_extensions():
    """All discovered extensions."""
    _discover()
    return list(_REGISTRY.values())


def list_manifests():
    """Manifests only — what the admin catalog endpoint renders."""
    return [e.manifest for e in list_extensions()]


def get_extension(extension_id: str):
    _discover()
    return _REGISTRY.get(extension_id)


def list_route_blueprints():
    """Every extension's own Flask Blueprint (from an optional routes.py),
    for register_blueprints() to register alongside the app's core blueprints."""
    _discover()
    return list(_ROUTE_BLUEPRINTS)
