"""
Process Monitor Module
Real-time monitoring of Rasa services using psutil
"""
import psutil
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import threading

# Store historical metrics
_metrics_history = {
    "timestamps": [],
    "response_times": [],
    "throughput": [],
    "error_rates": [],
    "cpu_usage": [],
    "memory_usage": []
}
_history_lock = threading.Lock()
MAX_HISTORY_POINTS = 360  # 1 hour at 10-second intervals


def get_process_by_port(port: int) -> Optional[Dict]:
    """Find process listening on a specific port."""
    try:
        for conn in psutil.net_connections(kind='inet'):
            if conn.laddr.port == port and conn.status == 'LISTEN':
                try:
                    proc = psutil.Process(conn.pid)
                    create_time = datetime.fromtimestamp(proc.create_time())
                    uptime = datetime.now() - create_time
                    
                    return {
                        "pid": proc.pid,
                        "name": proc.name(),
                        "status": proc.status(),
                        "cpu_percent": round(proc.cpu_percent(interval=0.1), 1),
                        "memory_mb": round(proc.memory_info().rss / (1024 * 1024), 1),
                        "memory_percent": round(proc.memory_percent(), 1),
                        "uptime_seconds": int(uptime.total_seconds()),
                        "uptime_formatted": format_uptime(uptime),
                        "port": port,
                        "cmdline": ' '.join(proc.cmdline()[:3]) if proc.cmdline() else ""
                    }
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
    except Exception as e:
        print(f"Error getting process by port {port}: {e}")
    return None


def get_process_by_name(name_pattern: str) -> Optional[Dict]:
    """Find process by name pattern."""
    try:
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = ' '.join(proc.info['cmdline'] or []).lower()
                if name_pattern.lower() in cmdline:
                    create_time = datetime.fromtimestamp(proc.create_time())
                    uptime = datetime.now() - create_time
                    
                    return {
                        "pid": proc.pid,
                        "name": proc.info['name'],
                        "status": proc.status(),
                        "cpu_percent": round(proc.cpu_percent(interval=0.1), 1),
                        "memory_mb": round(proc.memory_info().rss / (1024 * 1024), 1),
                        "memory_percent": round(proc.memory_percent(), 1),
                        "uptime_seconds": int(uptime.total_seconds()),
                        "uptime_formatted": format_uptime(uptime),
                        "cmdline": ' '.join(proc.info['cmdline'][:3]) if proc.info['cmdline'] else ""
                    }
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except Exception as e:
        print(f"Error getting process by name {name_pattern}: {e}")
    return None


def format_uptime(delta: timedelta) -> str:
    """Format uptime as human readable string."""
    total_seconds = int(delta.total_seconds())
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    
    if hours > 0:
        return f"{hours}h {minutes}m"
    elif minutes > 0:
        return f"{minutes}m {seconds}s"
    else:
        return f"{seconds}s"


def get_all_service_processes() -> Dict:
    """Get status of all Rasa-related services."""
    services = {}
    
    # Rasa Core (port 5005)
    rasa_core = get_process_by_port(5005)
    if rasa_core:
        services["rasa_core"] = {**rasa_core, "service_name": "Rasa Core", "expected_port": 5005}
    else:
        services["rasa_core"] = {
            "service_name": "Rasa Core",
            "status": "stopped",
            "expected_port": 5005
        }
    
    # Action Server (port 5055)
    action_server = get_process_by_port(5055)
    if action_server:
        services["action_server"] = {**action_server, "service_name": "Action Server", "expected_port": 5055}
    else:
        services["action_server"] = {
            "service_name": "Action Server",
            "status": "stopped",
            "expected_port": 5055
        }
    
    # Admin API (port 80)
    admin_api = get_process_by_port(80)
    if admin_api:
        services["admin_api"] = {**admin_api, "service_name": "Admin API", "expected_port": 80}
    else:
        services["admin_api"] = {
            "service_name": "Admin API",
            "status": "stopped",
            "expected_port": 80
        }
    
    return services


def get_system_resources() -> Dict:
    """Get overall system resource usage."""
    cpu_percent = psutil.cpu_percent(interval=0.1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    
    return {
        "cpu": {
            "percent": round(cpu_percent, 1),
            "cores": psutil.cpu_count()
        },
        "memory": {
            "percent": round(memory.percent, 1),
            "used_gb": round(memory.used / (1024**3), 2),
            "total_gb": round(memory.total / (1024**3), 2),
            "available_gb": round(memory.available / (1024**3), 2)
        },
        "disk": {
            "percent": round(disk.percent, 1),
            "used_gb": round(disk.used / (1024**3), 2),
            "total_gb": round(disk.total / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2)
        }
    }


def record_metrics(response_time: float = None, throughput: int = None, error_rate: float = None):
    """Record metrics for historical tracking."""
    with _history_lock:
        now = datetime.now().strftime("%H:%M:%S")
        
        # Get current system metrics
        cpu = psutil.cpu_percent(interval=0.1)
        memory = psutil.virtual_memory().percent
        
        _metrics_history["timestamps"].append(now)
        _metrics_history["cpu_usage"].append(round(cpu, 1))
        _metrics_history["memory_usage"].append(round(memory, 1))
        
        if response_time is not None:
            _metrics_history["response_times"].append(round(response_time, 1))
        elif _metrics_history["response_times"]:
            _metrics_history["response_times"].append(_metrics_history["response_times"][-1])
        else:
            _metrics_history["response_times"].append(0)
            
        if throughput is not None:
            _metrics_history["throughput"].append(throughput)
        elif _metrics_history["throughput"]:
            _metrics_history["throughput"].append(_metrics_history["throughput"][-1])
        else:
            _metrics_history["throughput"].append(0)
            
        if error_rate is not None:
            _metrics_history["error_rates"].append(round(error_rate, 2))
        elif _metrics_history["error_rates"]:
            _metrics_history["error_rates"].append(_metrics_history["error_rates"][-1])
        else:
            _metrics_history["error_rates"].append(0)
        
        # Keep only last MAX_HISTORY_POINTS
        for key in _metrics_history:
            if len(_metrics_history[key]) > MAX_HISTORY_POINTS:
                _metrics_history[key] = _metrics_history[key][-MAX_HISTORY_POINTS:]


def get_metrics_history(points: int = 60) -> Dict:
    """Get historical metrics for charts."""
    with _history_lock:
        # If no history, generate some initial data points
        if len(_metrics_history["timestamps"]) == 0:
            # Record current state
            record_metrics(response_time=100, throughput=10, error_rate=0.5)
        
        return {
            "timestamps": _metrics_history["timestamps"][-points:],
            "response_times": _metrics_history["response_times"][-points:],
            "throughput": _metrics_history["throughput"][-points:],
            "error_rates": _metrics_history["error_rates"][-points:],
            "cpu_usage": _metrics_history["cpu_usage"][-points:],
            "memory_usage": _metrics_history["memory_usage"][-points:]
        }


def start_metrics_collector(interval_seconds: int = 10):
    """Start background thread to collect metrics periodically."""
    def collector():
        while True:
            try:
                record_metrics()
            except Exception as e:
                print(f"Metrics collection error: {e}")
            time.sleep(interval_seconds)
    
    thread = threading.Thread(target=collector, daemon=True)
    thread.start()
    return thread


# Start collector when module is imported
_collector_thread = None
def ensure_collector_running():
    global _collector_thread
    if _collector_thread is None or not _collector_thread.is_alive():
        _collector_thread = start_metrics_collector(10)
