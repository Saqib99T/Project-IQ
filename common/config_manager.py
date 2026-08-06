"""
Configuration Manager Module
Reads configuration from the app.config / app.config.<profile> files.
"""

import configparser
import os
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Active profile: local or prod (set via APP_PROFILE env var)
_PROFILE = os.environ.get('APP_PROFILE', 'local').lower()

_config_dir = os.path.dirname(os.path.abspath(__file__))
_profile_config = os.path.join(_config_dir, f'app.config.{_PROFILE}')
_default_config = os.path.join(_config_dir, 'app.config')

# Use profile-specific config if it exists, otherwise fall back to app.config
CONFIG_FILE = _profile_config if os.path.exists(_profile_config) else _default_config

# Load .env file if present (APP_PROFILE and other env overrides)
try:
    from dotenv import load_dotenv
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_file):
        load_dotenv(env_file)
        logger.info(f"Loaded environment from {env_file}")
except ImportError:
    pass  # python-dotenv not installed, use system env vars


def load_config() -> configparser.ConfigParser:
    """Load configuration from app.config file."""
    config = configparser.ConfigParser()
    if os.path.exists(CONFIG_FILE):
        config.read(CONFIG_FILE)
    return config


def save_config(config: configparser.ConfigParser):
    """Save configuration to app.config file."""
    with open(CONFIG_FILE, 'w') as f:
        config.write(f)


def _env_secret(section: str, option: str, file_value: str) -> str:
    """Prefer a secret supplied via the environment over the config-file value.

    Convention: ``PIQ_<SECTION>_<OPTION>`` (uppercased). This lets prod/staging
    inject secrets at runtime (process env or an untracked, git-ignored .env)
    instead of committing them to app.config*. When the env var is unset/empty,
    the file value is returned, so existing setups keep working unchanged.

    Applied only inside secret getters (never in load_config/save_config) so a
    runtime-injected secret can never be written back into the tracked file via
    the admin "save config" path.
    """
    env_key = f"PIQ_{section}_{option}".upper()
    val = os.environ.get(env_key)
    return val if val not in (None, "") else file_value


def get_db_config() -> Dict[str, Any]:
    """Get database configuration settings."""
    config = load_config()
    return {
        'host': config.get('DATABASE', 'DB_HOST', fallback='localhost'),
        'port': config.getint('DATABASE', 'DB_PORT', fallback=5432),
        'database': config.get('DATABASE', 'DB_NAME', fallback='Chatbot'),
        'user': config.get('DATABASE', 'DB_USER', fallback='postgres'),
        'password': _env_secret('DATABASE', 'DB_PASSWORD',
                                config.get('DATABASE', 'DB_PASSWORD', fallback='12345')),
    }


def get_widget_config() -> Dict[str, str]:
    """Get widget configuration settings."""
    config = load_config()
    return {
        'title': config.get('WIDGET', 'WIDGET_TITLE', fallback='IT Support'),
        'subtitle': config.get('WIDGET', 'WIDGET_SUBTITLE', fallback='How can I help you today?'),
    }


def get_rasa_config() -> Dict[str, str]:
    """Get Rasa service URLs."""
    config = load_config()
    return {
        'api_url': config.get('RASA', 'RASA_API_URL', fallback='http://localhost:5005'),
        'action_url': config.get('RASA', 'RASA_ACTION_URL', fallback='http://127.0.0.1:5055/webhook'),
    }


def get_kb_config() -> Dict[str, Any]:
    """Get Knowledge Base configuration settings."""
    config = load_config()
    return {
        'enabled': config.getboolean('KNOWLEDGE_BASE', 'KB_ENABLED', fallback=True),
        'refresh_interval': config.getint('KNOWLEDGE_BASE', 'KB_REFRESH_INTERVAL', fallback=1800),
        'fallback_to_json': config.getboolean('KNOWLEDGE_BASE', 'KB_FALLBACK_JSON', fallback=True),
        'semantic_enabled': config.getboolean('KNOWLEDGE_BASE', 'KB_SEMANTIC_ENABLED', fallback=True),
        'semantic_model': config.get('KNOWLEDGE_BASE', 'KB_SEMANTIC_MODEL', fallback='all-MiniLM-L6-v2'),
        'semantic_weight': config.getfloat('KNOWLEDGE_BASE', 'KB_SEMANTIC_WEIGHT', fallback=0.6),
        'keyword_weight': config.getfloat('KNOWLEDGE_BASE', 'KB_KEYWORD_WEIGHT', fallback=0.4),
        'min_score_threshold': config.getfloat('KNOWLEDGE_BASE', 'KB_MIN_SCORE', fallback=0.3),
        'max_results': config.getint('KNOWLEDGE_BASE', 'KB_MAX_RESULTS', fallback=3),
        'section_search_enabled': config.getboolean('KNOWLEDGE_BASE', 'KB_SECTION_SEARCH_ENABLED', fallback=False),
        'section_min_words': config.getint('KNOWLEDGE_BASE', 'KB_SECTION_MIN_WORDS', fallback=60),
        'section_max_words': config.getint('KNOWLEDGE_BASE', 'KB_SECTION_MAX_WORDS', fallback=220),
        'section_max_results': config.getint('KNOWLEDGE_BASE', 'KB_SECTION_MAX_RESULTS', fallback=3),
        'section_clarify_min_score': config.getfloat('KNOWLEDGE_BASE', 'KB_SECTION_CLARIFY_MIN_SCORE', fallback=0.60),
        'section_clarify_max_score': config.getfloat('KNOWLEDGE_BASE', 'KB_SECTION_CLARIFY_MAX_SCORE', fallback=0.85),
        'qa_search_enabled': config.getboolean('KNOWLEDGE_BASE', 'KB_QA_SEARCH_ENABLED', fallback=False),
        'qa_min_score': config.getfloat('KNOWLEDGE_BASE', 'KB_QA_MIN_SCORE', fallback=0.85),
        'qa_max_results': config.getint('KNOWLEDGE_BASE', 'KB_QA_MAX_RESULTS', fallback=3),
    }


def get_kb_bot_config() -> Dict[str, str]:
    """Service-account credentials KBCacheManager uses to call itsm-service.

    The background refresh thread has no logged-in user to forward a JWT
    from, so it authenticates as a dedicated Keycloak client (client_credentials
    grant). That client's service-account user must carry IAM role "bot",
    which itsm-service maps to tenant role "service_account" — see
    common.iam_service.get_kb_bot_token for details. Leave both blank to
    disable itsm-service KB sourcing (cache falls back to JSON).
    """
    config = load_config()
    return {
        'client_id': config.get('KNOWLEDGE_BASE', 'kb_bot_client_id', fallback=''),
        'client_secret': _env_secret('KNOWLEDGE_BASE', 'kb_bot_client_secret',
                                     config.get('KNOWLEDGE_BASE', 'kb_bot_client_secret', fallback='')),
    }


def get_sla_config() -> Dict[str, int]:
    """Get SLA hours per priority."""
    config = load_config()
    return {
        'critical': config.getint('SLA', 'critical_hours', fallback=2),
        'high':     config.getint('SLA', 'high_hours',     fallback=4),
        'medium':   config.getint('SLA', 'medium_hours',   fallback=8),
        'low':      config.getint('SLA', 'low_hours',      fallback=24),
    }


def get_iam_config() -> Dict[str, str]:
    """Get IAM / Keycloak configuration settings."""
    config = load_config()
    return {
        'keycloak_url':          config.get('IAM', 'keycloak_url',           fallback='https://id.dev.iam.99technologies.com'),
        'realm':                 config.get('IAM', 'realm',                   fallback='99-iam'),
        'client_id':             config.get('IAM', 'client_id',               fallback='project-iq'),
        'api_url':               config.get('IAM', 'api_url',                 fallback='https://api.dev.iam.99technologies.com'),
        'backend_client_id':     config.get('IAM', 'backend_client_id',       fallback='project-iq-backend'),
        'backend_client_secret': _env_secret('IAM', 'backend_client_secret',
                                             config.get('IAM', 'backend_client_secret', fallback='')),
    }


def get_redis_config() -> Dict[str, Any]:
    """Redis connection settings (caching, Socket.IO bus, rate-limit storage)."""
    config = load_config()
    return {
        'enabled':  config.getboolean('REDIS', 'redis_enabled', fallback=False),
        'host':     config.get('REDIS', 'redis_host', fallback='localhost'),
        'port':     config.getint('REDIS', 'redis_port', fallback=6379),
        'db':       config.getint('REDIS', 'redis_db', fallback=0),
        'password': _env_secret('REDIS', 'redis_password',
                                config.get('REDIS', 'redis_password', fallback='')),
    }


def get_itsm_config() -> Dict[str, str]:
    """Get itsm-service URL configuration."""
    config = load_config()
    return {
        'service_url': config.get('ITSM', 'itsm_service_url', fallback='http://localhost:8000'),
    }


def get_shopify_config() -> Dict[str, Any]:
    """Global Shopify Partner app credentials (one per Project IQ deployment).

    This is deliberately NOT where a tenant's shop connection lives — a
    merchant's shop_domain + OAuth access_token are per-tenant and stored in
    the shopify_connections DB table (see common/db/_connection.py), since
    config_manager's file+env pattern only holds one value per key for the
    whole deployment. This function only returns the app's own client
    credentials, used to build the OAuth authorize URL and exchange codes.
    """
    config = load_config()
    return {
        'enabled':      config.getboolean('SHOPIFY', 'shopify_enabled', fallback=False),
        'api_version':  config.get('SHOPIFY', 'api_version', fallback='2026-01'),
        'client_id':    config.get('SHOPIFY', 'client_id', fallback=''),
        'client_secret': _env_secret('SHOPIFY', 'client_secret',
                                     config.get('SHOPIFY', 'client_secret', fallback='')),
        'redirect_uri': config.get('SHOPIFY', 'redirect_uri', fallback='http://localhost:8181/admin/shopify/callback'),
        'scopes':       config.get('SHOPIFY', 'scopes', fallback='read_orders,read_customers,write_orders'),
        # Per-tenant cap on write actions (refund/cancel/address-update) —
        # protects against a runaway/compromised session hammering write
        # mutations and eating into the shop's own GraphQL cost budget.
        # Read-only order lookups aren't limited here (Shopify's own
        # cost-based throttle already governs those).
        'write_rate_limit': config.get('SHOPIFY', 'write_rate_limit', fallback='10 per hour'),
    }


def get_platform_config() -> Dict[str, str]:
    """Get 99Tech platform-level identifiers."""
    config = load_config()
    return {'org_id': config.get('PLATFORM', 'org_id', fallback='')}


def get_all_config() -> Dict[str, str]:
    """Get all configuration as flat dictionary for admin API."""
    config = load_config()
    result = {}

    # Database settings
    result['DB_HOST'] = config.get('DATABASE', 'DB_HOST', fallback='localhost')
    result['DB_PORT'] = config.get('DATABASE', 'DB_PORT', fallback='5432')
    result['DB_NAME'] = config.get('DATABASE', 'DB_NAME', fallback='Chatbot')
    result['DB_USER'] = config.get('DATABASE', 'DB_USER', fallback='postgres')
    result['DB_PASSWORD'] = config.get('DATABASE', 'DB_PASSWORD', fallback='')

    # Rasa settings
    result['RASA_API_URL'] = config.get('RASA', 'RASA_API_URL', fallback='http://localhost:5005')

    # Widget settings
    result['WIDGET_TITLE'] = config.get('WIDGET', 'WIDGET_TITLE', fallback='')
    result['WIDGET_SUBTITLE'] = config.get('WIDGET', 'WIDGET_SUBTITLE', fallback='')

    # Session settings
    result['SESSION_TIMEOUT_MINUTES'] = config.get('SESSION', 'SESSION_TIMEOUT_MINUTES', fallback='10')
    result['SESSION_WARNING_MINUTES'] = config.get('SESSION', 'SESSION_WARNING_MINUTES', fallback='5')

    return result


def set_all_config(settings: Dict[str, str]):
    """Save all configuration from a flat dictionary to the local config file."""
    config = load_config()

    # Ensure sections exist
    for section in ['DATABASE', 'RASA', 'WIDGET', 'SESSION']:
        if not config.has_section(section):
            config.add_section(section)

    # Map flat keys to sections
    key_map = {
        'DB_HOST': ('DATABASE', 'DB_HOST'),
        'DB_PORT': ('DATABASE', 'DB_PORT'),
        'DB_NAME': ('DATABASE', 'DB_NAME'),
        'DB_USER': ('DATABASE', 'DB_USER'),
        'DB_PASSWORD': ('DATABASE', 'DB_PASSWORD'),
        'RASA_API_URL': ('RASA', 'RASA_API_URL'),
        'WIDGET_TITLE': ('WIDGET', 'WIDGET_TITLE'),
        'WIDGET_SUBTITLE': ('WIDGET', 'WIDGET_SUBTITLE'),
        'SESSION_TIMEOUT_MINUTES': ('SESSION', 'SESSION_TIMEOUT_MINUTES'),
        'SESSION_WARNING_MINUTES': ('SESSION', 'SESSION_WARNING_MINUTES'),
    }

    for key, value in settings.items():
        if key in key_map:
            section, option = key_map[key]
            config.set(section, option, str(value) if value else '')

    save_config(config)


def set_config_value(key: str, value: str):
    """Set a single configuration value."""
    set_all_config({key: value})


def get_profile() -> str:
    """Return the active profile name (local or prod)."""
    return _PROFILE


def get_server_config() -> Dict[str, Any]:
    """Get server configuration (port, CORS, debug mode)."""
    config = load_config()
    return {
        'admin_port': config.getint('SERVER', 'ADMIN_PORT', fallback=8181),
        'cors_origins': config.get('SERVER', 'CORS_ORIGINS', fallback='*'),
        'debug': config.getboolean('PROFILE', 'DEBUG', fallback=False),
    }


def get_handoff_config() -> Dict[str, Any]:
    """Get handoff infrastructure configuration (JWT, Socket.IO, SMTP, LLM).

    These are infrastructure-level settings that require a server restart to change.
    Runtime behaviour settings (thresholds, timeouts, queue rules) live in the DB
    and are retrieved via get_handoff_runtime_config() in conversation_db.py.
    """
    config = load_config()
    return {
        'operator_jwt_secret':            _env_secret('HANDOFF', 'operator_jwt_secret',
                                                      config.get('HANDOFF', 'operator_jwt_secret', fallback='dev-secret-change-me')),
        'operator_jwt_expiry_hours':       config.getint('HANDOFF', 'operator_jwt_expiry_hours', fallback=24),
        'socketio_async_mode':             config.get('HANDOFF', 'socketio_async_mode', fallback='eventlet'),
        'socketio_ping_timeout':           config.getint('HANDOFF', 'socketio_ping_timeout', fallback=60),
        'socketio_ping_interval':          config.getint('HANDOFF', 'socketio_ping_interval', fallback=25),
        'socketio_cors_allowed_origins':   config.get('HANDOFF', 'socketio_cors_allowed_origins', fallback='*'),
        'operator_heartbeat_timeout_secs': config.getint('HANDOFF', 'operator_heartbeat_timeout_secs', fallback=90),
        'smtp_host':                       config.get('HANDOFF', 'smtp_host', fallback=''),
        'smtp_port':                       config.getint('HANDOFF', 'smtp_port', fallback=587),
        'smtp_user':                       config.get('HANDOFF', 'smtp_user', fallback=''),
        'smtp_password':                   _env_secret('HANDOFF', 'smtp_password',
                                                       config.get('HANDOFF', 'smtp_password', fallback='')),
        'smtp_from':                       config.get('HANDOFF', 'smtp_from', fallback=''),
        'smtp_use_tls':                    config.getboolean('HANDOFF', 'smtp_use_tls', fallback=True),
        'llm_summary_enabled':             config.getboolean('HANDOFF', 'llm_summary_enabled', fallback=False),
        'llm_summary_model':               config.get('HANDOFF', 'llm_summary_model', fallback='claude-haiku-4-5-20251001'),
        'llm_api_key':                     _env_secret('HANDOFF', 'llm_api_key',
                                                       config.get('HANDOFF', 'llm_api_key', fallback='')),
    }


def is_using_infisical() -> bool:
    """Infisical was removed — always False (kept for backward compatibility)."""
    return False


def reload_secrets():
    """No-op — Infisical was removed; configuration is read from files on demand."""
    pass
