"""
Log Parser Module
Parse and filter Rasa log files for the observability dashboard
"""
import os
import re
from datetime import datetime
from typing import List, Dict, Optional
from collections import deque

# Log level patterns
LOG_PATTERNS = {
    'ERROR': re.compile(r'\b(ERROR|Error|error|CRITICAL|FATAL|Exception|Traceback)\b'),
    'WARNING': re.compile(r'\b(WARNING|Warning|warn|WARN)\b'),
    'INFO': re.compile(r'\b(INFO|Info|info)\b'),
    'DEBUG': re.compile(r'\b(DEBUG|Debug|debug)\b'),
}

# Timestamp patterns
TIMESTAMP_PATTERN = re.compile(r'(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})|(\d{2}:\d{2}:\d{2})')


class LogEntry:
    def __init__(self, timestamp: str, level: str, message: str, source: str = ""):
        self.timestamp = timestamp
        self.level = level
        self.message = message
        self.source = source
    
    def to_dict(self) -> Dict:
        return {
            "timestamp": self.timestamp,
            "level": self.level,
            "message": self.message,
            "source": self.source
        }


def detect_log_level(line: str) -> str:
    """Detect log level from line content."""
    for level, pattern in LOG_PATTERNS.items():
        if pattern.search(line):
            return level
    return "INFO"


def extract_timestamp(line: str) -> str:
    """Extract timestamp from log line."""
    match = TIMESTAMP_PATTERN.search(line)
    if match:
        return match.group(0)
    return datetime.now().strftime("%H:%M:%S")


def parse_log_file(file_path: str, max_lines: int = 100, level_filter: str = None) -> List[Dict]:
    """Parse a log file and return structured entries."""
    entries = []
    
    if not os.path.exists(file_path):
        return entries
    
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            # Read last N lines efficiently
            lines = deque(f, maxlen=max_lines * 2)  # Read more to filter
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            level = detect_log_level(line)
            
            # Apply level filter
            if level_filter and level_filter != "ALL":
                if level != level_filter:
                    continue
            
            timestamp = extract_timestamp(line)
            source = os.path.basename(file_path)
            
            entries.append(LogEntry(timestamp, level, line, source).to_dict())
            
            if len(entries) >= max_lines:
                break
        
        # Return in reverse chronological order
        return list(reversed(entries))
        
    except Exception as e:
        return [{"timestamp": datetime.now().strftime("%H:%M:%S"), 
                 "level": "ERROR", 
                 "message": f"Failed to read log file: {e}",
                 "source": "log_parser"}]


def get_all_logs(log_dir: str, max_lines: int = 100, level_filter: str = None) -> List[Dict]:
    """Get logs from all log files in directory."""
    all_entries = []
    
    if not os.path.exists(log_dir):
        return [{"timestamp": datetime.now().strftime("%H:%M:%S"),
                 "level": "WARNING",
                 "message": f"Log directory not found: {log_dir}",
                 "source": "system"}]
    
    # Common log files to check
    log_files = [
        "action_server.log",
        "action_server.err",
        "rasa_core.log",
        "rasa_core.err",
        "unified_server.log",
        "unified_server.err"
    ]
    
    for filename in log_files:
        file_path = os.path.join(log_dir, filename)
        if os.path.exists(file_path):
            entries = parse_log_file(file_path, max_lines=max_lines // len(log_files) + 10, level_filter=level_filter)
            all_entries.extend(entries)
    
    # Also check for any .log or .err files we might have missed
    try:
        for filename in os.listdir(log_dir):
            if filename.endswith(('.log', '.err')) and filename not in log_files:
                file_path = os.path.join(log_dir, filename)
                entries = parse_log_file(file_path, max_lines=20, level_filter=level_filter)
                all_entries.extend(entries)
    except Exception:
        pass
    
    # Sort by timestamp (most recent first) and limit
    all_entries.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    return all_entries[:max_lines]


def get_log_stats(log_dir: str) -> Dict:
    """Get statistics about logs."""
    stats = {
        "total_lines": 0,
        "error_count": 0,
        "warning_count": 0,
        "info_count": 0,
        "files": []
    }
    
    if not os.path.exists(log_dir):
        return stats
    
    try:
        for filename in os.listdir(log_dir):
            if filename.endswith(('.log', '.err')):
                file_path = os.path.join(log_dir, filename)
                file_stats = {"name": filename, "size_kb": 0, "lines": 0}
                
                try:
                    file_stats["size_kb"] = round(os.path.getsize(file_path) / 1024, 1)
                    
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        for line in f:
                            stats["total_lines"] += 1
                            file_stats["lines"] += 1
                            
                            level = detect_log_level(line)
                            if level == "ERROR":
                                stats["error_count"] += 1
                            elif level == "WARNING":
                                stats["warning_count"] += 1
                            elif level == "INFO":
                                stats["info_count"] += 1
                    
                    stats["files"].append(file_stats)
                except Exception:
                    pass
    except Exception:
        pass
    
    return stats


def search_logs(log_dir: str, query: str, max_results: int = 50) -> List[Dict]:
    """Search logs for a specific query."""
    results = []
    query_lower = query.lower()
    
    if not os.path.exists(log_dir):
        return results
    
    try:
        for filename in os.listdir(log_dir):
            if filename.endswith(('.log', '.err')):
                file_path = os.path.join(log_dir, filename)
                
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        for line in f:
                            if query_lower in line.lower():
                                results.append({
                                    "timestamp": extract_timestamp(line),
                                    "level": detect_log_level(line),
                                    "message": line.strip(),
                                    "source": filename
                                })
                                
                                if len(results) >= max_results:
                                    return results
                except Exception:
                    pass
    except Exception:
        pass
    
    return results
