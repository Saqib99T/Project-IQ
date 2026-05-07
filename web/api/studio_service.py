
import os
import shutil
import logging
import subprocess
import threading
from datetime import datetime
from typing import List, Dict, Optional, Any

logger = logging.getLogger(__name__)

class StudioService:
    def __init__(self, root_dir: str):
        self.root_dir = os.path.abspath(root_dir)
        self.data_dir = os.path.join(self.root_dir, 'data')
        self.history_dir = os.path.join(self.data_dir, 'history')
        self.models_dir = os.path.join(self.root_dir, 'models')
        
        # Ensure history directory exists
        os.makedirs(self.history_dir, exist_ok=True)
        
        # Whitelisted files for editing
        self.EDITABLE_FILES = {
            'domain.yml': os.path.join(self.root_dir, 'domain.yml'),
            'config.yml': os.path.join(self.root_dir, 'config.yml'),
            'endpoints.yml': os.path.join(self.root_dir, 'endpoints.yml'),
            'credentials.yml': os.path.join(self.root_dir, 'credentials.yml'),
            'data/nlu.yml': os.path.join(self.data_dir, 'nlu.yml'),
            'data/stories.yml': os.path.join(self.data_dir, 'stories.yml'),
            'data/rules.yml': os.path.join(self.data_dir, 'rules.yml')
        }
        
        # Training status
        self.is_training = False
        self.training_process = None
        self.recent_logs = []

    def get_editable_files(self) -> List[Dict[str, str]]:
        """List all files available for editing."""
        files = []
        for name, path in self.EDITABLE_FILES.items():
            if os.path.exists(path):
                files.append({
                    "name": name,
                    "path": path,
                    "last_modified": datetime.fromtimestamp(os.path.getmtime(path)).isoformat(),
                    "size": os.path.getsize(path)
                })
        return files

    def read_file(self, filename: str) -> Optional[str]:
        """Read content of a specific file."""
        if filename not in self.EDITABLE_FILES:
            raise ValueError("File not allowed")
            
        path = self.EDITABLE_FILES[filename]
        if not os.path.exists(path):
            return None
            
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()

    def write_file(self, filename: str, content: str) -> bool:
        """Write content to file with backup."""
        if filename not in self.EDITABLE_FILES:
            raise ValueError("File not allowed")
            
        target_path = self.EDITABLE_FILES[filename]
        
        # Create backup if file exists
        if os.path.exists(target_path):
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"{os.path.basename(target_path)}.{timestamp}.bak"
            backup_path = os.path.join(self.history_dir, backup_name)
            try:
                shutil.copy2(target_path, backup_path)
                logger.info(f"Created backup: {backup_path}")
            except Exception as e:
                logger.error(f"Backup failed: {e}")
                raise e

        # Write new content
        try:
            with open(target_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        except Exception as e:
            logger.error(f"Write failed: {e}")
            raise e

    def get_history(self, filename: str) -> List[Dict[str, Any]]:
        """Get backup history for a file."""
        if filename not in self.EDITABLE_FILES:
            raise ValueError("File not allowed")
        
        base_name = os.path.basename(self.EDITABLE_FILES[filename])
        backups = []
        
        if os.path.exists(self.history_dir):
            for f in os.listdir(self.history_dir):
                if f.startswith(base_name) and f.endswith(".bak"):
                    timestamp_str = f.replace(f"{base_name}.", "").replace(".bak", "")
                    full_path = os.path.join(self.history_dir, f)
                    backups.append({
                        "filename": f,
                        "original": filename,
                        "timestamp": timestamp_str,
                        "size": os.path.getsize(full_path),
                        "path": full_path
                    })
        
        # Sort by timestamp (newest first)
        backups.sort(key=lambda x: x['timestamp'], reverse=True)
        return backups

    def restore_backup(self, filename: str, backup_filename: str) -> bool:
        """Restore a file from a specific backup."""
        if filename not in self.EDITABLE_FILES:
            raise ValueError("File not allowed")
            
        target_path = self.EDITABLE_FILES[filename]
        backup_path = os.path.join(self.history_dir, backup_filename)
        
        if not os.path.exists(backup_path):
            raise ValueError("Backup file not found")
            
        # Create a "pre-restore" backup of the current state just in case
        self.write_file(filename, self.read_file(filename))
        
        # Restore
        shutil.copy2(backup_path, target_path)
        return True

    def train_model(self) -> bool:
        """Trigger background training process."""
        if self.is_training:
            return False
            
        self.is_training = True
        self.recent_logs = []
        
        def run_train():
            try:
                # Need to use the full path to python/rasa in venv
                # Assuming this script runs from actions/.. so root is one level up
                # But safer to rely on 'rasa' being in path or use sys.executable
                
                cmd = [sys.executable, "-m", "rasa", "train"]
                
                process = subprocess.Popen(
                    cmd,
                    cwd=self.root_dir,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1
                )
                
                self.training_process = process
                
                for line in process.stdout:
                    self.recent_logs.append(line)
                    # Keep log size manageable
                    if len(self.recent_logs) > 1000:
                        self.recent_logs.pop(0)
                        
                process.wait()
                
                if process.returncode == 0:
                    self.recent_logs.append("\n✅ Training completed successfully!")
                else:
                    self.recent_logs.append(f"\n❌ Training failed with exit code {process.returncode}")
                    
            except Exception as e:
                self.recent_logs.append(f"\n❌ Exception during training: {e}")
            finally:
                self.is_training = False
                self.training_process = None

        thread = threading.Thread(target=run_train)
        thread.start()
        return True

    def get_training_status(self) -> Dict[str, Any]:
        """Get current training status and logs."""
        return {
            "is_training": self.is_training,
            "logs": "".join(self.recent_logs[-50:]) # Return last 50 lines
        }

    def get_project_stats(self) -> Dict[str, int]:
        """Get statistics about the Rasa project (intents, stories, etc)."""
        stats = {
            "intents": 0,
            "entities": 0,
            "slots": 0,
            "responses": 0,
            "forms": 0,
            "actions": 0,
            "stories": 0,
            "rules": 0,
            "nlu_examples": 0
        }
        
        try:
            import yaml
            
            # 1. Parse Domain
            if os.path.exists(self.EDITABLE_FILES['domain.yml']):
                with open(self.EDITABLE_FILES['domain.yml'], 'r', encoding='utf-8') as f:
                    domain = yaml.safe_load(f) or {}
                    stats['intents'] = len(domain.get('intents', []) or [])
                    stats['entities'] = len(domain.get('entities', []) or [])
                    stats['slots'] = len(domain.get('slots', {}) or {})
                    stats['responses'] = len(domain.get('responses', {}) or {})
                    stats['forms'] = len(domain.get('forms', {}) or {})
                    stats['actions'] = len(domain.get('actions', []) or [])

            # 2. Parse Stories
            if os.path.exists(self.EDITABLE_FILES['data/stories.yml']):
                with open(self.EDITABLE_FILES['data/stories.yml'], 'r', encoding='utf-8') as f:
                    stories_data = yaml.safe_load(f) or {}
                    # Rasa 2.0/3.0 format: stories are in a list under 'stories' key
                    stats['stories'] = len(stories_data.get('stories', []) or [])

            # 3. Parse Rules
            if os.path.exists(self.EDITABLE_FILES['data/rules.yml']):
                with open(self.EDITABLE_FILES['data/rules.yml'], 'r', encoding='utf-8') as f:
                    rules_data = yaml.safe_load(f) or {}
                    stats['rules'] = len(rules_data.get('rules', []) or [])

            # 4. Parse NLU
            if os.path.exists(self.EDITABLE_FILES['data/nlu.yml']):
                with open(self.EDITABLE_FILES['data/nlu.yml'], 'r', encoding='utf-8') as f:
                    nlu_data = yaml.safe_load(f) or {}
                    nlu_items = nlu_data.get('nlu', []) or []
                    # Count examples? Or just intents defined in NLU?
                    # Let's count total examples across all intents
                    total_examples = 0
                    for item in nlu_items:
                        if 'examples' in item:
                            # Examples are usually a string with - bullet points
                            examples = item['examples'].strip().split('\n')
                            total_examples += len([e for e in examples if e.strip().startswith('-')])
                    stats['nlu_examples'] = total_examples

        except Exception as e:
            logger.error(f"Failed to calculate stats: {e}")
            
        return stats

    # ── Aliases / missing methods expected by the blueprint ──────────────────

    def list_files(self) -> List[Dict[str, str]]:
        return self.get_editable_files()

    def get_stats(self) -> Dict[str, int]:
        return self.get_project_stats()

    def start_training(self) -> Dict[str, Any]:
        started = self.train_model()
        return {"started": started, "already_running": not started}

    def get_training_status(self, job_id: str = None) -> Dict[str, Any]:
        return {
            "is_training": self.is_training,
            "logs": "".join(self.recent_logs[-50:])
        }

    def list_models(self) -> List[Dict[str, Any]]:
        models = []
        if os.path.exists(self.models_dir):
            for f in sorted(os.listdir(self.models_dir), reverse=True):
                if f.endswith('.tar.gz'):
                    full = os.path.join(self.models_dir, f)
                    models.append({
                        "name": f,
                        "path": full,
                        "size": os.path.getsize(full),
                        "created": datetime.fromtimestamp(os.path.getmtime(full)).isoformat()
                    })
        return models

    def get_nlu_data(self) -> Dict[str, Any]:
        try:
            import yaml
            path = self.EDITABLE_FILES.get('data/nlu.yml')
            if not path or not os.path.exists(path):
                return {"nlu": []}
            with open(path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
            return data
        except Exception as e:
            logger.error(f"get_nlu_data error: {e}")
            return {"nlu": []}

    def get_stories(self) -> Dict[str, Any]:
        try:
            import yaml
            result = {}
            for key, fname in [('stories', 'data/stories.yml'), ('rules', 'data/rules.yml')]:
                path = self.EDITABLE_FILES.get(fname)
                if path and os.path.exists(path):
                    with open(path, 'r', encoding='utf-8') as f:
                        data = yaml.safe_load(f) or {}
                    result[key] = data.get(key, [])
                else:
                    result[key] = []
            return result
        except Exception as e:
            logger.error(f"get_stories error: {e}")
            return {"stories": [], "rules": []}

    def add_nlu_example(self, intent: str, example: str) -> bool:
        try:
            import yaml
            path = self.EDITABLE_FILES['data/nlu.yml']
            with open(path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f) or {"version": "3.1", "nlu": []}
            nlu = data.get('nlu', [])
            for item in nlu:
                if item.get('intent') == intent:
                    existing = item.get('examples', '')
                    item['examples'] = existing.rstrip() + f"\n- {example}\n"
                    break
            else:
                nlu.append({"intent": intent, "examples": f"- {example}\n"})
            data['nlu'] = nlu
            return self.write_file('data/nlu.yml', yaml.dump(data, allow_unicode=True))
        except Exception as e:
            logger.error(f"add_nlu_example error: {e}")
            raise

    def delete_nlu_example(self, intent: str, example: str) -> bool:
        try:
            import yaml
            path = self.EDITABLE_FILES['data/nlu.yml']
            with open(path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f) or {"version": "3.1", "nlu": []}
            for item in data.get('nlu', []):
                if item.get('intent') == intent:
                    lines = [l for l in item.get('examples', '').split('\n')
                             if l.strip() and l.strip().lstrip('- ') != example.strip()]
                    item['examples'] = '\n'.join(lines) + '\n'
                    break
            return self.write_file('data/nlu.yml', yaml.dump(data, allow_unicode=True))
        except Exception as e:
            logger.error(f"delete_nlu_example error: {e}")
            raise

    def get_history(self, filename: str = None) -> List[Dict[str, Any]]:
        """Return backup history — optionally filtered to a specific file."""
        if filename:
            return self._get_file_history(filename)
        all_backups = []
        for fname in self.EDITABLE_FILES:
            try:
                all_backups.extend(self._get_file_history(fname))
            except Exception:
                pass
        all_backups.sort(key=lambda x: x['timestamp'], reverse=True)
        return all_backups

    def _get_file_history(self, filename: str) -> List[Dict[str, Any]]:
        if filename not in self.EDITABLE_FILES:
            return []
        base_name = os.path.basename(self.EDITABLE_FILES[filename])
        backups = []
        if os.path.exists(self.history_dir):
            for f in os.listdir(self.history_dir):
                if f.startswith(base_name) and f.endswith('.bak'):
                    ts = f.replace(f"{base_name}.", '').replace('.bak', '')
                    full = os.path.join(self.history_dir, f)
                    backups.append({
                        "version_id": f,
                        "filename": f,
                        "original": filename,
                        "timestamp": ts,
                        "size": os.path.getsize(full),
                    })
        return backups

    def restore_version(self, version_id: str) -> bool:
        """Restore from a backup identified by its filename (version_id)."""
        backup_path = os.path.join(self.history_dir, version_id)
        if not os.path.exists(backup_path):
            raise ValueError(f"Version not found: {version_id}")
        # Identify original file from backup name
        for fname, fpath in self.EDITABLE_FILES.items():
            base = os.path.basename(fpath)
            if version_id.startswith(base):
                return self.restore_backup(fname, version_id)
        raise ValueError(f"Cannot map version {version_id} to a known file")


import sys
# Initialize global instance
# Assuming root_dir is the 'core' directory where Rasa project exists
_base_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_project_root = os.path.join(_base_root, 'core')
studio_service = StudioService(_project_root)
