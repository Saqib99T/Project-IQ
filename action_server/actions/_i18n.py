"""
Bot response localization for the custom action server.

Covers the *dynamic* canned strings emitted by custom actions (the messages
Rasa response templates can't easily express) in the five supported languages:
en, de, fr, es, ar. Static `utter_*` templates in core/domain.yml are out of
scope here — they remain a separate content-localization task.

Usage in an action:

    from action_server.actions._i18n import t, resolve_lang, lang_events

    lang = resolve_lang(tracker)            # from user_lang slot or message text
    dispatcher.utter_message(text=t("kb_no_answer", lang))
    return lang_events(tracker)             # persist user_lang slot if newly detected

Keep keys stable; English is the source of truth and the fallback for any
missing key/language, so a partial translation never blanks a message.
"""
from rasa_sdk import Tracker
from rasa_sdk.events import SlotSet

try:
    from common.lang_detect import detect_lang, DEFAULT_LANG, SUPPORTED
except Exception:  # pragma: no cover - detection is best-effort
    SUPPORTED = ("en", "de", "fr", "es", "ar")
    DEFAULT_LANG = "en"

    def detect_lang(_text):
        return DEFAULT_LANG


# Languages whose script is right-to-left (consumed by the widget/mobile for dir).
RTL_LANGS = {"ar"}

# key -> {lang -> string}. English is mandatory per key; other languages fall
# back to English when absent.
_CATALOG = {
    "kb_no_answer": {
        "en": "I couldn't find a specific answer in our knowledge base for that question.\n\nWould you like to:",
        "de": "Ich konnte in unserer Wissensdatenbank keine passende Antwort auf diese Frage finden.\n\nMöchten Sie:",
        "fr": "Je n'ai pas trouvé de réponse précise à cette question dans notre base de connaissances.\n\nSouhaitez-vous :",
        "es": "No encontré una respuesta específica a esa pregunta en nuestra base de conocimientos.\n\n¿Le gustaría:",
        "ar": "لم أتمكن من العثور على إجابة محددة لهذا السؤال في قاعدة المعرفة لدينا.\n\nهل تريد:",
    },
    "btn_create_ticket": {
        "en": "🎫 Create a support ticket", "de": "🎫 Support-Ticket erstellen",
        "fr": "🎫 Créer un ticket d'assistance", "es": "🎫 Crear un ticket de soporte",
        "ar": "🎫 إنشاء تذكرة دعم",
    },
    "btn_my_tickets": {
        "en": "📋 See my tickets", "de": "📋 Meine Tickets anzeigen",
        "fr": "📋 Voir mes tickets", "es": "📋 Ver mis tickets",
        "ar": "📋 عرض تذاكري",
    },
    "btn_get_help": {
        "en": "❓ Get help", "de": "❓ Hilfe erhalten",
        "fr": "❓ Obtenir de l'aide", "es": "❓ Obtener ayuda",
        "ar": "❓ الحصول على مساعدة",
    },
    "kb_more_help": {
        "en": "Did this answer your question, or is there anything else I can help with?",
        "de": "Hat das Ihre Frage beantwortet, oder kann ich Ihnen noch bei etwas anderem helfen?",
        "fr": "Cela répond-il à votre question, ou puis-je vous aider sur autre chose ?",
        "es": "¿Esto responde a su pregunta, o puedo ayudarle con algo más?",
        "ar": "هل أجاب هذا عن سؤالك، أم يمكنني مساعدتك في شيء آخر؟",
    },
    "fallback_not_understood": {
        "en": "Sorry, I didn't quite understand that. Could you rephrase it?",
        "de": "Entschuldigung, das habe ich nicht ganz verstanden. Können Sie es anders formulieren?",
        "fr": "Désolé, je n'ai pas bien compris. Pourriez-vous reformuler ?",
        "es": "Lo siento, no entendí bien eso. ¿Podría reformularlo?",
        "ar": "عذرًا، لم أفهم ذلك تمامًا. هل يمكنك إعادة صياغته؟",
    },
    "fallback_default": {
        "en": "I'm not sure I understood. You can search the knowledge base or log in to manage your tickets.",
        "de": "Ich bin nicht sicher, ob ich das verstanden habe. Sie können die Wissensdatenbank durchsuchen oder sich anmelden, um Ihre Tickets zu verwalten.",
        "fr": "Je ne suis pas sûr d'avoir compris. Vous pouvez consulter la base de connaissances ou vous connecter pour gérer vos tickets.",
        "es": "No estoy seguro de haber entendido. Puede buscar en la base de conocimientos o iniciar sesión para gestionar sus tickets.",
        "ar": "لست متأكدًا من أنني فهمت. يمكنك البحث في قاعدة المعرفة أو تسجيل الدخول لإدارة تذاكرك.",
    },
    "btn_search_kb": {
        "en": "📚 Search Knowledge Base", "de": "📚 Wissensdatenbank durchsuchen",
        "fr": "📚 Rechercher dans la base de connaissances", "es": "📚 Buscar en la base de conocimientos",
        "ar": "📚 البحث في قاعدة المعرفة",
    },
    "btn_login": {
        "en": "🔑 Login", "de": "🔑 Anmelden", "fr": "🔑 Connexion",
        "es": "🔑 Iniciar sesión", "ar": "🔑 تسجيل الدخول",
    },
    "handoff_connecting": {
        "en": "Let me connect you with a support agent. One moment, please.",
        "de": "Ich verbinde Sie mit einem Support-Mitarbeiter. Einen Moment bitte.",
        "fr": "Je vous mets en relation avec un agent d'assistance. Un instant, s'il vous plaît.",
        "es": "Le pondré en contacto con un agente de soporte. Un momento, por favor.",
        "ar": "سأوصلك بأحد موظفي الدعم. لحظة من فضلك.",
    },
    "handoff_no_agents": {
        "en": "No agents are available right now. I can create a support ticket so the team can follow up.",
        "de": "Derzeit ist kein Mitarbeiter verfügbar. Ich kann ein Support-Ticket erstellen, damit sich das Team meldet.",
        "fr": "Aucun agent n'est disponible pour le moment. Je peux créer un ticket d'assistance pour un suivi par l'équipe.",
        "es": "No hay agentes disponibles en este momento. Puedo crear un ticket de soporte para que el equipo le dé seguimiento.",
        "ar": "لا يوجد موظفون متاحون الآن. يمكنني إنشاء تذكرة دعم ليتابعها الفريق.",
    },
    "handoff_queued": {
        "en": "You're in the queue — an agent will be with you shortly.",
        "de": "Sie sind in der Warteschlange — ein Mitarbeiter ist gleich für Sie da.",
        "fr": "Vous êtes dans la file d'attente — un agent sera bientôt avec vous.",
        "es": "Está en la cola — un agente le atenderá en breve.",
        "ar": "أنت في قائمة الانتظار — سيكون أحد الموظفين معك قريبًا.",
    },
    "ticket_created": {
        "en": "Your support ticket has been created. You'll be notified of any updates.",
        "de": "Ihr Support-Ticket wurde erstellt. Sie werden über alle Aktualisierungen benachrichtigt.",
        "fr": "Votre ticket d'assistance a été créé. Vous serez informé de toute mise à jour.",
        "es": "Su ticket de soporte ha sido creado. Se le notificará cualquier actualización.",
        "ar": "تم إنشاء تذكرة الدعم الخاصة بك. سيتم إعلامك بأي تحديثات.",
    },
    "need_login": {
        "en": "You'll need to sign in first so I can do that for you.",
        "de": "Dafür müssen Sie sich zuerst anmelden, damit ich das für Sie erledigen kann.",
        "fr": "Vous devez d'abord vous connecter pour que je puisse faire cela pour vous.",
        "es": "Primero debe iniciar sesión para que pueda hacer eso por usted.",
        "ar": "يجب عليك تسجيل الدخول أولاً حتى أتمكن من القيام بذلك لك.",
    },
}


def t(key: str, lang: str = DEFAULT_LANG, **fmt) -> str:
    """Localized string for `key` in `lang`, with English fallback. Any **fmt
    kwargs are applied via str.format."""
    entry = _CATALOG.get(key, {})
    text = entry.get(lang) or entry.get(DEFAULT_LANG) or key
    if fmt:
        try:
            text = text.format(**fmt)
        except Exception:
            pass
    return text


def _latest_user_text(tracker: Tracker) -> str:
    try:
        return (tracker.latest_message or {}).get("text") or ""
    except Exception:
        return ""


def _slot(tracker, name):
    """tracker.get_slot, tolerant of minimal/fake trackers without the method."""
    try:
        return tracker.get_slot(name)
    except Exception:
        return None


def resolve_lang(tracker: Tracker) -> str:
    """The user's language for this turn. Prefers an already-detected
    `user_lang` slot; otherwise detects from the latest message. Always returns
    a supported code (DEFAULT_LANG on no signal)."""
    slot = _slot(tracker, "user_lang") if tracker else None
    if slot in SUPPORTED:
        # Re-detect only when the new message carries a clear non-default signal,
        # so a user who switches language mid-chat is followed.
        detected = detect_lang(_latest_user_text(tracker))
        return detected if detected != DEFAULT_LANG else slot
    return detect_lang(_latest_user_text(tracker))


def lang_events(tracker: Tracker, lang: str = None):
    """Persist the detected language as the `user_lang` slot, but only when it's
    a non-default language and differs from what's stored — so the common
    English path stays a no-op (returns []) and we don't thrash the slot."""
    lang = lang or resolve_lang(tracker)
    current = _slot(tracker, "user_lang") if tracker else None
    if lang == DEFAULT_LANG or lang == current:
        return []
    return [SlotSet("user_lang", lang)]


def is_rtl(lang: str) -> bool:
    return lang in RTL_LANGS
