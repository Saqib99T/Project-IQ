"""
Training Manager Module
Read and write Rasa training data files (NLU, stories, rules)
"""
import logging
import os
import yaml
import re
from typing import Dict, List, Optional, Any
from datetime import datetime
import subprocess
import threading

# Project paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
NLU_FILE = os.path.join(DATA_DIR, 'nlu.yml')
STORIES_FILE = os.path.join(DATA_DIR, 'stories.yml')
RULES_FILE = os.path.join(DATA_DIR, 'rules.yml')
DOMAIN_FILE = os.path.join(PROJECT_ROOT, 'domain.yml')

# Training state
_training_jobs = {}


logger = logging.getLogger(__name__)

def get_nlu_data() -> Dict:
    """
    Read NLU training data and return structured format.
    """
    try:
        if not os.path.exists(NLU_FILE):
            return {"success": False, "error": "nlu.yml not found"}
        
        with open(NLU_FILE, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        intents = {}
        nlu_items = data.get('nlu', [])
        
        for item in nlu_items:
            intent_name = item.get('intent')
            examples_raw = item.get('examples', '')
            
            if intent_name and examples_raw:
                # Parse examples - each line starting with "- " is an example
                examples = []
                for line in examples_raw.strip().split('\n'):
                    line = line.strip()
                    if line.startswith('- '):
                        example_text = line[2:].strip()
                        
                        # Extract entities from [value](entity) format
                        entities = []
                        entity_pattern = r'\[([^\]]+)\]\(([^)]+)\)'
                        for match in re.finditer(entity_pattern, example_text):
                            entities.append({
                                "value": match.group(1),
                                "entity": match.group(2)
                            })
                        
                        # Clean text (remove entity markup for display)
                        clean_text = re.sub(entity_pattern, r'\1', example_text)
                        
                        examples.append({
                            "text": example_text,
                            "clean_text": clean_text,
                            "entities": entities
                        })
                
                if intent_name not in intents:
                    intents[intent_name] = []
                intents[intent_name].extend(examples)
        
        return {
            "success": True,
            "intents": intents,
            "total_intents": len(intents),
            "total_examples": sum(len(ex) for ex in intents.values())
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def add_nlu_example(intent: str, text: str) -> Dict:
    """
    Add a new training example to an intent.
    """
    try:
        if not os.path.exists(NLU_FILE):
            return {"success": False, "error": "nlu.yml not found"}
        
        with open(NLU_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
            data = yaml.safe_load(content)
        
        nlu_items = data.get('nlu', [])
        intent_found = False
        
        for item in nlu_items:
            if item.get('intent') == intent:
                # Add example to existing intent
                examples = item.get('examples', '')
                if not examples.endswith('\n'):
                    examples += '\n'
                examples += f'- {text}\n'
                item['examples'] = examples
                intent_found = True
                break
        
        if not intent_found:
            # Create new intent
            nlu_items.append({
                'intent': intent,
                'examples': f'- {text}\n'
            })
        
        # Write back
        with open(NLU_FILE, 'w', encoding='utf-8') as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        
        return {"success": True, "message": f"Added example to intent '{intent}'"}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_nlu_example(intent: str, text: str) -> Dict:
    """
    Delete a training example from an intent.
    """
    try:
        with open(NLU_FILE, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        nlu_items = data.get('nlu', [])
        
        for item in nlu_items:
            if item.get('intent') == intent:
                examples = item.get('examples', '')
                lines = examples.strip().split('\n')
                new_lines = [l for l in lines if not l.strip().endswith(text)]
                item['examples'] = '\n'.join(new_lines) + '\n'
                break
        
        with open(NLU_FILE, 'w', encoding='utf-8') as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        
        return {"success": True, "message": f"Deleted example from intent '{intent}'"}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_stories_data() -> Dict:
    """
    Read stories and rules from YAML files.
    """
    stories = []
    
    # Read stories.yml
    if os.path.exists(STORIES_FILE):
        try:
            with open(STORIES_FILE, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
            
            for story in data.get('stories', []):
                stories.append({
                    "name": story.get('story'),
                    "type": "story",
                    "steps": parse_story_steps(story.get('steps', []))
                })
        except Exception as e:
            logger.warning("Error reading stories.yml: %s", e)
    
    # Read rules.yml
    if os.path.exists(RULES_FILE):
        try:
            with open(RULES_FILE, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
            
            for rule in data.get('rules', []):
                stories.append({
                    "name": rule.get('rule'),
                    "type": "rule",
                    "steps": parse_story_steps(rule.get('steps', []))
                })
        except Exception as e:
            logger.warning("Error reading rules.yml: %s", e)
    
    return {
        "success": True,
        "flows": stories,
        "total_stories": len([s for s in stories if s['type'] == 'story']),
        "total_rules": len([s for s in stories if s['type'] == 'rule'])
    }


def parse_story_steps(steps: List[Dict]) -> List[Dict]:
    """
    Parse story steps into a consistent format.
    """
    parsed = []
    
    for step in steps:
        if 'intent' in step:
            parsed.append({"type": "intent", "name": step['intent']})
        elif 'action' in step:
            parsed.append({"type": "action", "name": step['action']})
        elif 'slot_was_set' in step:
            slots = step['slot_was_set']
            for slot in slots:
                if isinstance(slot, dict):
                    for k, v in slot.items():
                        parsed.append({"type": "slot", "name": k, "value": v})
        elif 'or' in step:
            parsed.append({"type": "or", "alternatives": step['or']})
        elif 'checkpoint' in step:
            parsed.append({"type": "checkpoint", "name": step['checkpoint']})
    
    return parsed


def get_domain_responses() -> Dict:
    """
    Get response templates from domain.yml.
    """
    try:
        if not os.path.exists(DOMAIN_FILE):
            return {"success": False, "error": "domain.yml not found"}
        
        with open(DOMAIN_FILE, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        responses = data.get('responses', {})
        formatted = {}
        
        for key, variations in responses.items():
            formatted[key] = [v.get('text', '') for v in variations if isinstance(v, dict)]
        
        return {
            "success": True,
            "responses": formatted,
            "total": len(formatted)
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def start_training() -> Dict:
    """
    Start Rasa training in background.
    """
    job_id = f"train_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    def run_training():
        _training_jobs[job_id]['status'] = 'running'
        _training_jobs[job_id]['progress'] = 10
        
        try:
            process = subprocess.Popen(
                ['rasa', 'train', '--force'],
                cwd=PROJECT_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )
            
            output_lines = []
            for line in process.stdout:
                output_lines.append(line)
                # Update progress based on output
                if 'Training NLU' in line:
                    _training_jobs[job_id]['progress'] = 30
                elif 'Training Core' in line or 'Training dialogue' in line:
                    _training_jobs[job_id]['progress'] = 60
                elif 'Training finished' in line or 'Your Rasa model is trained' in line:
                    _training_jobs[job_id]['progress'] = 100
            
            process.wait()
            
            if process.returncode == 0:
                _training_jobs[job_id]['status'] = 'completed'
                _training_jobs[job_id]['progress'] = 100
                # Find the new model file
                models_dir = os.path.join(PROJECT_ROOT, 'models')
                if os.path.exists(models_dir):
                    models = sorted(os.listdir(models_dir), reverse=True)
                    if models:
                        _training_jobs[job_id]['model'] = models[0]
            else:
                _training_jobs[job_id]['status'] = 'failed'
                _training_jobs[job_id]['error'] = 'Training process returned non-zero exit code'
            
            _training_jobs[job_id]['output'] = output_lines[-50:]  # Keep last 50 lines
            
        except Exception as e:
            _training_jobs[job_id]['status'] = 'failed'
            _training_jobs[job_id]['error'] = str(e)
    
    _training_jobs[job_id] = {
        'status': 'starting',
        'progress': 0,
        'started_at': datetime.now().isoformat()
    }
    
    thread = threading.Thread(target=run_training, daemon=True)
    thread.start()
    
    return {
        "success": True,
        "job_id": job_id,
        "status": "starting"
    }


def get_training_status(job_id: str) -> Dict:
    """
    Get status of a training job.
    """
    if job_id not in _training_jobs:
        return {"success": False, "error": "Job not found"}
    
    job = _training_jobs[job_id]
    return {
        "success": True,
        "job_id": job_id,
        "status": job.get('status'),
        "progress": job.get('progress', 0),
        "model": job.get('model'),
        "error": job.get('error'),
        "output": job.get('output', [])[-10:]  # Last 10 lines
    }


def get_available_models() -> Dict:
    """
    List available trained models.
    """
    try:
        models_dir = os.path.join(PROJECT_ROOT, 'models')
        if not os.path.exists(models_dir):
            return {"success": True, "models": []}
        
        models = []
        for filename in sorted(os.listdir(models_dir), reverse=True):
            if filename.endswith('.tar.gz'):
                filepath = os.path.join(models_dir, filename)
                models.append({
                    "name": filename,
                    "size_mb": round(os.path.getsize(filepath) / (1024 * 1024), 2),
                    "created": datetime.fromtimestamp(os.path.getctime(filepath)).isoformat()
                })
        
        return {"success": True, "models": models[:10]}  # Last 10 models
        
    except Exception as e:
        return {"success": False, "error": str(e)}
