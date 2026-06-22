"""Semantic intent index for the low-confidence NLU fallback.

When Rasa's NLU confidence is low (nlu_fallback), we embed the user's message
and find the nearest NLU training example to recover a likely intent — a free,
local, "did you mean?" safety net. Reuses the sentence-transformers model that
common.vector_search already loads for KB search (no extra model in memory).

Kept free of rasa_sdk imports so it can be unit-tested standalone.
"""
import os
import re
import hashlib
import logging
from typing import List, Tuple, Optional

import numpy as np

logger = logging.getLogger(__name__)

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_NLU = os.path.join(_REPO, "core", "data", "nlu.yml")
_CACHE = os.path.join(_REPO, "common", "intent_index_cache.npz")

_emb: Optional[np.ndarray] = None      # (N, D) L2-normalized example embeddings
_intents: Optional[List[str]] = None   # parallel intent labels
_texts: Optional[List[str]] = None     # parallel example texts


def _parse_nlu() -> List[Tuple[str, str]]:
    """Return (example_text, intent) pairs from nlu.yml, stripping entity markup."""
    pairs: List[Tuple[str, str]] = []
    cur = None
    with open(_NLU, encoding="utf-8") as fh:
        for raw in fh:
            m = re.match(r'^\s*-\s*intent:\s*(\S+)', raw)
            if m:
                cur = m.group(1)
                continue
            ex = re.match(r'^\s*-\s+(.*\S)\s*$', raw)
            if cur and ex:
                t = ex.group(1).strip()
                t = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', t)   # [val](entity) -> val
                t = re.sub(r'\[([^\]]+)\]\{[^}]+\}', r'\1', t)   # [val]{synonym} -> val
                if t:
                    pairs.append((t, cur))
    return pairs


def _nlu_hash() -> str:
    h = hashlib.sha256()
    with open(_NLU, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()[:16]


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.clip(n, 1e-9, None)


def _build() -> None:
    global _emb, _intents, _texts
    pairs = _parse_nlu()
    texts = [t for t, _ in pairs]
    intents = [i for _, i in pairs]
    from common.vector_search import get_model
    model = get_model()
    emb = np.asarray(model.encode(texts, batch_size=64, show_progress_bar=False), dtype=np.float32)
    _emb, _intents, _texts = _normalize(emb), intents, texts
    try:
        np.savez_compressed(_CACHE, emb=_emb, intents=np.array(intents),
                            texts=np.array(texts), h=_nlu_hash())
        logger.info("intent index built (%d examples) and cached", len(texts))
    except Exception as e:  # cache is an optimization; never fatal
        logger.warning("intent index cache save failed: %s", e)


def _ensure() -> None:
    global _emb, _intents, _texts
    if _emb is not None:
        return
    try:
        if os.path.exists(_CACHE):
            d = np.load(_CACHE, allow_pickle=True)
            if str(d["h"]) == _nlu_hash():
                _emb, _intents, _texts = d["emb"], list(d["intents"]), list(d["texts"])
                logger.info("intent index loaded from cache (%d examples)", len(_texts))
                return
    except Exception as e:
        logger.warning("intent index cache load failed (%s); rebuilding", e)
    _build()


def nearest_intent(text: str) -> Optional[Tuple[str, float, str]]:
    """Nearest NLU example to `text`: (intent, cosine_score in [-1,1], example)."""
    if not text or not text.strip():
        return None
    _ensure()
    if _emb is None or len(_emb) == 0:
        return None
    from common.vector_search import get_model
    q = _normalize(np.asarray(get_model().encode([text]), dtype=np.float32))[0]
    sims = _emb @ q
    i = int(np.argmax(sims))
    return _intents[i], float(sims[i]), _texts[i]
