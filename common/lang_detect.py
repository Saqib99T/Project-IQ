"""
Lightweight, dependency-free language detection for the chat bot.

Scope is deliberately the five officially-supported languages — English (en),
German (de), French (fr), Spanish (es) and Arabic (ar). It is NOT a general
language identifier: it scores a short message against per-language stopword
sets plus script/diacritic signals and returns the best of those five, falling
back to English when there is no signal (short or ambiguous text).

Why not langdetect/fasttext: this is a Rasa project with a tight dependency
graph (packaging pins have bitten us before), and we only need 5 languages, so
a small heuristic is both safer and good enough for routing the bot's own
canned responses. KB *retrieval* is already language-agnostic via the
multilingual embedder, so a wrong guess here only affects which canned strings
are shown, never whether the answer is found.
"""
import re

SUPPORTED = ("en", "de", "fr", "es", "ar")
DEFAULT_LANG = "en"

# Arabic (incl. supplement + presentation forms).
_ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

# Most-common function words per language. Kept short and high-signal; entries
# that are unique to one language (e.g. German "ich", Spanish "necesito") do the
# heavy lifting for short queries.
_STOPWORDS = {
    "en": {"the", "is", "are", "a", "an", "and", "to", "of", "in", "you", "i",
           "how", "what", "can", "do", "does", "my", "for", "with", "please",
           "help", "need", "want", "hello", "hi", "thanks", "thank", "not"},
    "de": {"der", "die", "das", "und", "ich", "nicht", "ein", "eine", "ist",
           "wie", "kann", "mein", "meine", "bitte", "hilfe", "brauche", "für",
           "mit", "sie", "wir", "danke", "hallo", "ein", "nein", "ja", "ich"},
    "fr": {"le", "la", "les", "un", "une", "et", "je", "ne", "pas", "est",
           "comment", "puis", "mon", "ma", "aide", "besoin", "pour", "avec",
           "vous", "merci", "bonjour", "salut", "oui", "non", "ai"},
    "es": {"el", "la", "los", "las", "un", "una", "y", "no", "es", "como",
           "puedo", "mi", "por", "favor", "ayuda", "necesito", "para", "con",
           "usted", "gracias", "hola", "si", "quiero", "está", "estoy"},
}

# Diacritics / punctuation that strongly indicate one language.
_DIACRITIC_SIGNALS = {
    "de": "äöüß",
    "fr": "àâçèêëîïôûùœ",
    "es": "ñ¿¡",          # é/á/í/ó/ú are shared/ambiguous, left out on purpose
}


def detect_lang(text: str) -> str:
    """Return one of SUPPORTED for the message, or DEFAULT_LANG when unsure."""
    if not text or not text.strip():
        return DEFAULT_LANG

    # Arabic is unambiguous by script — decide it first.
    arabic_hits = len(_ARABIC_RE.findall(text))
    letters = sum(1 for c in text if c.isalpha())
    if arabic_hits and (letters == 0 or arabic_hits / max(letters, 1) > 0.3):
        return "ar"

    lowered = text.lower()
    tokens = _WORD_RE.findall(lowered)
    scores = {lang: 0.0 for lang in ("en", "de", "fr", "es")}

    for tok in tokens:
        for lang in scores:
            if tok in _STOPWORDS[lang]:
                scores[lang] += 1.0

    # Diacritics are a strong per-language signal — weight them heavily so a
    # single "ñ" or "ü" tips a short query.
    for lang, chars in _DIACRITIC_SIGNALS.items():
        for ch in chars:
            if ch in lowered:
                scores[lang] += 2.0

    best = max(scores, key=lambda k: scores[k])
    if scores[best] == 0:
        return DEFAULT_LANG
    # On a tie, prefer English (least surprising / safest default).
    if best != "en" and scores[best] == scores["en"]:
        return "en"
    return best
