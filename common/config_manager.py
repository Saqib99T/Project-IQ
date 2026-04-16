"""
Configuration Manager Module
Handles loading configuration from Infisical vault with fallback to app.config file.
"""

import configparser
import os
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Active profile: local or prod (set via APP_PROFILE env var)
_PROFILE = os.environ.get('APP_PROFILE', 'local').lower()

_config_dir = os.path.dirname(os.path.abspath(__file__))
_profile_config = os.path.join(_config_dir, f'app.config.{_PROFILE}')
_default_config = os.path.join(_config_dir, 'app.config')

# Use profile-specific config if it exists, otherwise fall back to app.config
CONFIG_FILE = _profile_config if os.path.exists(_profile_config) else _default_config

# Load .env file if it exists (for Infisical credentials)
try:
    from dotenv import load_dotenv
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_file):
        load_dotenv(env_file)
        logger.info(f"Loaded environment from {env_file}")
except ImportError:
    pass  # python-dotenv not installed, use system env vars

# Infisical configuration from environment variables
INFISICAL_CLIENT_ID = os.environ.get('INFISICAL_CLIENT_ID', '')
INFISICAL_CLIENT_SECRET = os.environ.get('INFISICAL_CLIENT_SECRET', '')
INFISICAL_PROJECT_ID = os.environ.get('INFISICAL_PROJECT_ID', '')
INFISICAL_ENVIRONMENT = os.environ.get('INFISICAL_ENVIRONMENT', 'dev')
INFISICAL_SITE_URL = os.environ.get('INFISICAL_SITE_URL', 'https://app.infisical.com')

# Cached secrets from Infisical
_infisical_secrets: Optional[Dict[str, str]] = None
_infisical_available: Optional[bool] = None


def _init_infisical() -> bool:
    """Initialize Infisical client and fetch secrets."""
    global _infisical_secrets, _infisical_available
    
    if _infisical_available is not None:
        return _infisical_available
    
    if not all([INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID]):
        logger.info("Infisical credentials not configured. Using local config file.")
        _infisical_available = False
        return False
    
    try:
        from infisical_sdk import InfisicalSDKClient
        
        client = InfisicalSDKClient(host=INFISICAL_SITE_URL)
        
        # Authenticate with Universal Auth
        client.auth.universal_auth.login(
            client_id=INFISICAL_CLIENT_ID,
            client_secret=INFISICAL_CLIENT_SECRET
        )
        
        # Fetch all secrets for the environment
        secrets_response = client.secrets.list_secrets(
            project_id=INFISICAL_PROJECT_ID,
            environment_slug=INFISICAL_ENVIRONMENT,
            secret_path='/'
        )
        
        # Cache secrets as a dictionary (using correct attribute names)
        _infisical_secrets = {s.secretKey: s.secretValue for s in secrets_response.secrets}
        _infisical_available = True
        logger.info(f"Infisical initialized successfully. Loaded {len(_infisical_secrets)} secrets.")
        print(f"[Infisical] Connected! Loaded {len(_infisical_secrets)} secrets from '{INFISICAL_ENVIRONMENT}' environment.")
        return True
        
    except ImportError:
        logger.warning("infisical-sdk package not installed. Using local config file.")
        _infisical_available = False
        return False
    except Exception as e:
        logger.warning(f"Failed to connect to Infisical: {e}. Using local config file.")
        print(f"[Infisical] Failed to connect: {e}. Using local config file.")
        _infisical_available = False
        return False


def _get_secret(key: str, fallback: str = '') -> str:
    """Get a secret from Infisical or fallback to local config."""
    if _init_infisical() and _infisical_secrets:
        return _infisical_secrets.get(key, fallback)
    return fallback


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


def get_glpi_config() -> Dict[str, str]:
    """Get GLPI configuration settings."""
    if _init_infisical() and _infisical_secrets:
        return {
            'api_url': _get_secret('GLPI_API_URL', 'http://localhost:8083/apirest.php'),
            'app_token': _get_secret('GLPI_APP_TOKEN', ''),
            'user_token': _get_secret('GLPI_USER_TOKEN', ''),
        }
    
    # Fallback to local config
    config = load_config()
    return {
        'api_url': config.get('GLPI', 'GLPI_API_URL', fallback='http://localhost:8083/apirest.php'),
        'app_token': config.get('GLPI', 'GLPI_APP_TOKEN', fallback=''),
        'user_token': config.get('GLPI', 'GLPI_USER_TOKEN', fallback=''),
    }


def get_db_config() -> Dict[str, Any]:
    """Get database configuration settings."""
    if _init_infisical() and _infisical_secrets:
        return {
            'host': _get_secret('DB_HOST', 'localhost'),
            'port': int(_get_secret('DB_PORT', '5432')),
            'database': _get_secret('DB_NAME', 'Chatbot'),
            'user': _get_secret('DB_USER', 'postgres'),
            'password': _get_secret('DB_PASSWORD', '12345'),
        }
    
    # Fallback to local config
    config = load_config()
    return {
        'host': config.get('DATABASE', 'DB_HOST', fallback='localhost'),
        'port': config.getint('DATABASE', 'DB_PORT', fallback=5432),
        'database': config.get('DATABASE', 'DB_NAME', fallback='Chatbot'),
        'user': config.get('DATABASE', 'DB_USER', fallback='postgres'),
        'password': config.get('DATABASE', 'DB_PASSWORD', fallback='12345'),
    }


def get_widget_config() -> Dict[str, str]:
    """Get widget configuration settings."""
    if _init_infisical() and _infisical_secrets:
        return {
            'title': _get_secret('WIDGET_TITLE', 'IT Support'),
            'subtitle': _get_secret('WIDGET_SUBTITLE', 'How can I help you today?'),
        }
    
    # Fallback to local config
    config = load_config()
    return {
        'title': config.get('WIDGET', 'WIDGET_TITLE', fallback='IT Support'),
        'subtitle': config.get('WIDGET', 'WIDGET_SUBTITLE', fallback='How can I help you today?'),
    }


def get_rasa_config() -> Dict[str, str]:
    """Get Rasa service URLs."""
    if _init_infisical() and _infisical_secrets:
        return {
            'api_url': _get_secret('RASA_API_URL', 'http://localhost:5005'),
            'action_url': _get_secret('RASA_ACTION_URL', 'http://127.0.0.1:5055/webhook'),
        }
    config = load_config()
    return {
        'api_url': config.get('RASA', 'RASA_API_URL', fallback='http://localhost:5005'),
        'action_url': config.get('RASA', 'RASA_ACTION_URL', fallback='http://127.0.0.1:5055/webhook'),
    }


def get_kb_config() -> Dict[str, Any]:
    """Get Knowledge Base configuration settings."""
    if _init_infisical() and _infisical_secrets:
        return {
            'enabled': _get_secret('KB_GLPI_ENABLED', 'true').lower() == 'true',
            'refresh_interval': int(_get_secret('KB_REFRESH_INTERVAL', '1800')),
            'fallback_to_json': _get_secret('KB_FALLBACK_JSON', 'true').lower() == 'true',
            'semantic_enabled': _get_secret('KB_SEMANTIC_ENABLED', 'true').lower() == 'true',
            'semantic_model': _get_secret('KB_SEMANTIC_MODEL', 'all-MiniLM-L6-v2'),
            'semantic_weight': float(_get_secret('KB_SEMANTIC_WEIGHT', '0.6')),
            'keyword_weight': float(_get_secret('KB_KEYWORD_WEIGHT', '0.4')),
            'min_score_threshold': float(_get_secret('KB_MIN_SCORE', '0.3')),
            'max_results': int(_get_secret('KB_MAX_RESULTS', '3')),
            'section_search_enabled': _get_secret('KB_SECTION_SEARCH_ENABLED', 'false').lower() == 'true',
            'section_min_words': int(_get_secret('KB_SECTION_MIN_WORDS', '60')),
            'section_max_words': int(_get_secret('KB_SECTION_MAX_WORDS', '220')),
            'section_max_results': int(_get_secret('KB_SECTION_MAX_RESULTS', '3')),
            'section_clarify_min_score': float(_get_secret('KB_SECTION_CLARIFY_MIN_SCORE', '0.60')),
            'section_clarify_max_score': float(_get_secret('KB_SECTION_CLARIFY_MAX_SCORE', '0.85')),
            'qa_search_enabled': _get_secret('KB_QA_SEARCH_ENABLED', 'false').lower() == 'true',
            'qa_min_score': float(_get_secret('KB_QA_MIN_SCORE', '0.85')),
            'qa_max_results': int(_get_secret('KB_QA_MAX_RESULTS', '3')),
        }

    # Fallback to local config
    config = load_config()
    return {
        'enabled': config.getboolean('KNOWLEDGE_BASE', 'KB_GLPI_ENABLED', fallback=True),
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


def get_all_config() -> Dict[str, str]:
    """Get all configuration as flat dictionary for admin API."""
    if _init_infisical() and _infisical_secrets:
        return {
            'GLPI_API_URL': _get_secret('GLPI_API_URL', ''),
            'GLPI_APP_TOKEN': _get_secret('GLPI_APP_TOKEN', ''),
            'GLPI_USER_TOKEN': _get_secret('GLPI_USER_TOKEN', ''),
            'DB_HOST': _get_secret('DB_HOST', 'localhost'),
            'DB_PORT': _get_secret('DB_PORT', '5432'),
            'DB_NAME': _get_secret('DB_NAME', 'Chatbot'),
            'DB_USER': _get_secret('DB_USER', 'postgres'),
            'DB_PASSWORD': _get_secret('DB_PASSWORD', ''),
            'RASA_API_URL': _get_secret('RASA_API_URL', 'http://localhost:5005'),
            'WIDGET_TITLE': _get_secret('WIDGET_TITLE', ''),
            'WIDGET_SUBTITLE': _get_secret('WIDGET_SUBTITLE', ''),
        }
    
    # Fallback to local config
    config = load_config()
    result = {}
    
    # GLPI settings
    result['GLPI_API_URL'] = config.get('GLPI', 'GLPI_API_URL', fallback='')
    result['GLPI_APP_TOKEN'] = config.get('GLPI', 'GLPI_APP_TOKEN', fallback='')
    result['GLPI_USER_TOKEN'] = config.get('GLPI', 'GLPI_USER_TOKEN', fallback='')
    
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

    return result


def set_all_config(settings: Dict[str, str]):
    """Save all configuration from flat dictionary.
    
    Note: When using Infisical, secrets should be managed via Infisical UI.
    This function only updates the local config file.
    """
    config = load_config()
    
    # Ensure sections exist
    for section in ['GLPI', 'DATABASE', 'RASA', 'WIDGET', 'SESSION']:
        if not config.has_section(section):
            config.add_section(section)

    # Map flat keys to sections
    key_map = {
        'GLPI_API_URL': ('GLPI', 'GLPI_API_URL'),
        'GLPI_APP_TOKEN': ('GLPI', 'GLPI_APP_TOKEN'),
        'GLPI_USER_TOKEN': ('GLPI', 'GLPI_USER_TOKEN'),
        'DB_HOST': ('DATABASE', 'DB_HOST'),
        'DB_PORT': ('DATABASE', 'DB_PORT'),
        'DB_NAME': ('DATABASE', 'DB_NAME'),
        'DB_USER': ('DATABASE', 'DB_USER'),
        'DB_PASSWORD': ('DATABASE', 'DB_PASSWORD'),
        'RASA_API_URL': ('RASA', 'RASA_API_URL'),
        'WIDGET_TITLE': ('WIDGET', 'WIDGET_TITLE'),
        'WIDGET_SUBTITLE': ('WIDGET', 'WIDGET_SUBTITLE'),
        'SESSION_TIMEOUT_MINUTES': ('SESSION', 'SESSION_TIMEOUT_MINUTES'),
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
    if _init_infisical() and _infisical_secrets:
        return {
            'admin_port': int(_get_secret('ADMIN_PORT', '8181')),
            'cors_origins': _get_secret('CORS_ORIGINS', '*'),
            'debug': _get_secret('DEBUG', 'false').lower() == 'true',
        }
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
    if _init_infisical() and _infisical_secrets:
        return {
            'operator_jwt_secret':            _get_secret('OPERATOR_JWT_SECRET', 'dev-secret-change-me'),
            'operator_jwt_expiry_hours':       int(_get_secret('OPERATOR_JWT_EXPIRY_HOURS', '24')),
            'socketio_async_mode':             _get_secret('SOCKETIO_ASYNC_MODE', 'eventlet'),
            'socketio_ping_timeout':           int(_get_secret('SOCKETIO_PING_TIMEOUT', '60')),
            'socketio_ping_interval':          int(_get_secret('SOCKETIO_PING_INTERVAL', '25')),
            'socketio_cors_allowed_origins':   _get_secret('SOCKETIO_CORS_ALLOWED_ORIGINS', '*'),
            'operator_heartbeat_timeout_secs': int(_get_secret('OPERATOR_HEARTBEAT_TIMEOUT_SECS', '90')),
            'smtp_host':                       _get_secret('SMTP_HOST', ''),
            'smtp_port':                       int(_get_secret('SMTP_PORT', '587')),
            'smtp_user':                       _get_secret('SMTP_USER', ''),
            'smtp_password':                   _get_secret('SMTP_PASSWORD', ''),
            'smtp_from':                       _get_secret('SMTP_FROM', ''),
            'smtp_use_tls':                    _get_secret('SMTP_USE_TLS', 'true').lower() == 'true',
            'llm_summary_enabled':             _get_secret('LLM_SUMMARY_ENABLED', 'false').lower() == 'true',
            'llm_summary_model':               _get_secret('LLM_SUMMARY_MODEL', 'claude-haiku-4-5-20251001'),
            'llm_api_key':                     _get_secret('LLM_API_KEY', ''),
            'glpi_group_enforcement':          _get_secret('GLPI_GROUP_ENFORCEMENT', 'false').lower() == 'true',
            'glpi_support_group_name':         _get_secret('GLPI_SUPPORT_GROUP_NAME', 'Support'),
        }

    config = load_config()
    return {
        'operator_jwt_secret':            config.get('HANDOFF', 'operator_jwt_secret', fallback='dev-secret-change-me'),
        'operator_jwt_expiry_hours':       config.getint('HANDOFF', 'operator_jwt_expiry_hours', fallback=24),
        'socketio_async_mode':             config.get('HANDOFF', 'socketio_async_mode', fallback='eventlet'),
        'socketio_ping_timeout':           config.getint('HANDOFF', 'socketio_ping_timeout', fallback=60),
        'socketio_ping_interval':          config.getint('HANDOFF', 'socketio_ping_interval', fallback=25),
        'socketio_cors_allowed_origins':   config.get('HANDOFF', 'socketio_cors_allowed_origins', fallback='*'),
        'operator_heartbeat_timeout_secs': config.getint('HANDOFF', 'operator_heartbeat_timeout_secs', fallback=90),
        'smtp_host':                       config.get('HANDOFF', 'smtp_host', fallback=''),
        'smtp_port':                       config.getint('HANDOFF', 'smtp_port', fallback=587),
        'smtp_user':                       config.get('HANDOFF', 'smtp_user', fallback=''),
        'smtp_password':                   config.get('HANDOFF', 'smtp_password', fallback=''),
        'smtp_from':                       config.get('HANDOFF', 'smtp_from', fallback=''),
        'smtp_use_tls':                    config.getboolean('HANDOFF', 'smtp_use_tls', fallback=True),
        'llm_summary_enabled':             config.getboolean('HANDOFF', 'llm_summary_enabled', fallback=False),
        'llm_summary_model':               config.get('HANDOFF', 'llm_summary_model', fallback='claude-haiku-4-5-20251001'),
        'llm_api_key':                     config.get('HANDOFF', 'llm_api_key', fallback=''),
        'glpi_group_enforcement':          config.getboolean('HANDOFF', 'glpi_group_enforcement', fallback=False),
        'glpi_support_group_name':         config.get('HANDOFF', 'glpi_support_group_name', fallback='Support'),
    }


def is_using_infisical() -> bool:
    """Check if Infisical is being used for secrets."""
    return _init_infisical()


def reload_secrets():
    """Force reload secrets from Infisical."""
    global _infisical_secrets, _infisical_available
    _infisical_secrets = None
    _infisical_available = None
    _init_infisical()
