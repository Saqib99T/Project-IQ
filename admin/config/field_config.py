import os
import yaml
from typing import Dict, Any, Optional

class FieldConfig:
    def __init__(self, field_name: str = 'it'):
        """
        Initialize field configuration.
        
        Args:
            field_name: The field name (e.g., 'it', 'hr', 'finance'). Defaults to 'it'.
        """
        self.field_name = field_name.lower()
        self.config = self._load_config()
    
    def _load_config(self) -> Dict[str, Any]:
        """Load configuration for the specified field."""
        try:
            config_dir = os.path.join(os.path.dirname(__file__), 'fields')
            config_path = os.path.join(config_dir, f"{self.field_name}.yaml")
            
            # Default to IT config if field config doesn't exist
            if not os.path.exists(config_path):
                config_path = os.path.join(config_dir, "it.yaml")
                
            with open(config_path, 'r', encoding='utf-8') as file:
                return yaml.safe_load(file)
                
        except Exception as e:
            # Fallback to default IT config
            return {
                'name': 'Support',
                'greeting': 'Hello! How can I assist you today?',
                'ticket_types': ['General Inquiry'],
                'priorities': [
                    {'name': 'High', 'description': 'High priority'},
                    {'name': 'Medium', 'description': 'Medium priority'},
                    {'name': 'Low', 'description': 'Low priority'}
                ],
                'responses': {
                    'create_ticket': 'I\'ve created a support ticket for you.',
                    'check_status': 'Let me check the status of your request.',
                    'escalation': 'This has been escalated to the appropriate team.',
                    'closing': 'Thank you for contacting support.'
                },
                'custom_fields': []
            }
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value by key."""
        return self.config.get(key, default)
    
    def get_response(self, response_type: str, default: str = "") -> str:
        """Get a response template by type."""
        return self.config.get('responses', {}).get(response_type, default)
    
    def get_ticket_types(self) -> list:
        """Get available ticket types for this field."""
        return self.config.get('ticket_types', ['General'])
    
    def get_priorities(self) -> list:
        """Get available priorities for this field."""
        return self.config.get('priorities', [])
    
    def get_custom_fields(self) -> list:
        """Get custom fields configuration for this field."""
        return self.config.get('custom_fields', [])

# Global field configuration manager
class FieldConfigManager:
    _instance = None
    _configs = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FieldConfigManager, cls).__new__(cls)
        return cls._instance
    
    @classmethod
    def get_config(cls, field_name: str = 'it') -> FieldConfig:
        """Get or create a field configuration."""
        if field_name not in cls._configs:
            cls._configs[field_name] = FieldConfig(field_name)
        return cls._configs[field_name]

# Helper function to get field configuration
def get_field_config(field_name: str = 'it') -> FieldConfig:
    """Helper function to get field configuration."""
    return FieldConfigManager().get_config(field_name)
