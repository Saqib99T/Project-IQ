#!/usr/bin/env python3
"""
Verification script for GLPI Knowledge Base Integration
Tests all components without restarting services
"""

import sys
import os

# Add actions directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'actions'))

def print_header(title):
    print("\n" + "="*60)
    print(f"  {title}")
    print("="*60)

def print_status(check, status, message):
    symbol = "✓" if status else "✗"
    color = "\033[92m" if status else "\033[91m"
    reset = "\033[0m"
    print(f"{color}{symbol}{reset} [{check}] {message}")

def main():
    print_header("KNOWLEDGE BASE INTEGRATION VERIFICATION")

    all_passed = True

    # Check 1: sentence-transformers installed
    print_header("1. Dependency Check")
    try:
        import sentence_transformers
        version = sentence_transformers.__version__
        print_status("DEPENDENCY", True, f"sentence-transformers installed (v{version})")
    except ImportError as e:
        print_status("DEPENDENCY", False, f"sentence-transformers NOT installed: {e}")
        print("   Run: pip install sentence-transformers==2.3.1")
        all_passed = False

    # Check 2: Configuration file
    print_header("2. Configuration Check")
    config_path = os.path.join(os.path.dirname(__file__), 'app.config')
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            content = f.read()
            if '[KNOWLEDGE_BASE]' in content:
                print_status("CONFIG", True, "app.config has [KNOWLEDGE_BASE] section")

                # Check key settings
                if 'KB_GLPI_ENABLED=true' in content:
                    print_status("CONFIG", True, "KB_GLPI_ENABLED=true")
                else:
                    print_status("CONFIG", False, "KB_GLPI_ENABLED not set to true")
                    all_passed = False

                if 'KB_SEMANTIC_ENABLED=true' in content:
                    print_status("CONFIG", True, "KB_SEMANTIC_ENABLED=true")
                else:
                    print_status("CONFIG", False, "KB_SEMANTIC_ENABLED not set to true")
                    all_passed = False
            else:
                print_status("CONFIG", False, "app.config missing [KNOWLEDGE_BASE] section")
                all_passed = False
    else:
        print_status("CONFIG", False, f"app.config not found at {config_path}")
        all_passed = False

    # Check 3: KB Cache Manager file
    print_header("3. Code Files Check")
    kb_manager_path = os.path.join(os.path.dirname(__file__), 'actions', 'kb_cache_manager.py')
    if os.path.exists(kb_manager_path):
        print_status("FILES", True, "kb_cache_manager.py exists")

        # Check file size (should be ~650 lines, ~25KB+)
        size_kb = os.path.getsize(kb_manager_path) / 1024
        if size_kb > 20:
            print_status("FILES", True, f"kb_cache_manager.py size: {size_kb:.1f}KB (looks good)")
        else:
            print_status("FILES", False, f"kb_cache_manager.py size: {size_kb:.1f}KB (too small, may be incomplete)")
            all_passed = False
    else:
        print_status("FILES", False, "kb_cache_manager.py NOT found")
        all_passed = False

    # Check config_manager.py has get_kb_config
    config_manager_path = os.path.join(os.path.dirname(__file__), 'actions', 'config_manager.py')
    if os.path.exists(config_manager_path):
        with open(config_manager_path, 'r') as f:
            content = f.read()
            if 'def get_kb_config()' in content:
                print_status("FILES", True, "config_manager.py has get_kb_config()")
            else:
                print_status("FILES", False, "config_manager.py missing get_kb_config()")
                all_passed = False

    # Check glpi_service.py has KB methods
    glpi_service_path = os.path.join(os.path.dirname(__file__), 'actions', 'glpi_service.py')
    if os.path.exists(glpi_service_path):
        with open(glpi_service_path, 'r') as f:
            content = f.read()
            kb_methods_found = 0
            if 'def get_all_knowbase_items' in content:
                kb_methods_found += 1
            if 'def get_knowbase_item' in content:
                kb_methods_found += 1
            if 'def search_knowbase_items' in content:
                kb_methods_found += 1

            if kb_methods_found == 3:
                print_status("FILES", True, "glpi_service.py has all 3 KB methods")
            else:
                print_status("FILES", False, f"glpi_service.py has only {kb_methods_found}/3 KB methods")
                all_passed = False

    # Check 4: Try to import KB cache manager
    print_header("4. Module Import Check")
    try:
        from actions.kb_cache_manager import kb_cache
        print_status("IMPORT", True, "kb_cache_manager module imports successfully")

        # Check if it has required methods
        methods = ['search_articles', 'get_all_articles', 'get_cache_info', 'force_refresh']
        missing_methods = []
        for method in methods:
            if not hasattr(kb_cache, method):
                missing_methods.append(method)

        if missing_methods:
            print_status("IMPORT", False, f"Missing methods: {', '.join(missing_methods)}")
            all_passed = False
        else:
            print_status("IMPORT", True, "All required methods present")

    except Exception as e:
        print_status("IMPORT", False, f"Failed to import kb_cache_manager: {e}")
        import traceback
        print("\n" + traceback.format_exc())
        all_passed = False

    # Check 5: KB Cache Status (if running)
    print_header("5. Runtime Status Check")
    try:
        from actions.kb_cache_manager import kb_cache
        cache_info = kb_cache.get_cache_info()

        article_count = cache_info.get('article_count', 0)
        source = cache_info.get('source', 'unknown')
        last_refresh = cache_info.get('last_refresh')

        if article_count > 0:
            print_status("RUNTIME", True, f"KB cache loaded: {article_count} articles")
            print_status("RUNTIME", True, f"Source: {source}")
            if last_refresh:
                print_status("RUNTIME", True, f"Last refresh: {last_refresh}")
        else:
            print_status("RUNTIME", False, "KB cache is empty (0 articles)")
            print("   This may be normal if services just started or GLPI is unreachable")

        # Check model info
        model_info = cache_info.get('model_info')
        if model_info:
            model_name = model_info.get('model_name', 'unknown')
            embedding_dim = model_info.get('embedding_dimension', 0)
            print_status("RUNTIME", True, f"Model: {model_name} ({embedding_dim} dimensions)")
        else:
            print_status("RUNTIME", False, "Model info not available")

    except Exception as e:
        print_status("RUNTIME", False, f"Failed to get KB status: {e}")
        print("   Action Server may not be running, or KB cache not initialized")

    # Check 6: Admin UI Files
    print_header("6. Admin UI Files Check")
    ui_files = [
        ('client_ui/public/components/knowledge_base.html', 'KB Admin Component'),
        ('client_ui/public/js/admin-knowledge-base.js', 'KB Admin JavaScript'),
    ]

    for file_path, description in ui_files:
        full_path = os.path.join(os.path.dirname(__file__), file_path)
        if os.path.exists(full_path):
            size_kb = os.path.getsize(full_path) / 1024
            print_status("UI", True, f"{description} exists ({size_kb:.1f}KB)")
        else:
            print_status("UI", False, f"{description} NOT found")
            all_passed = False

    # Check admin.html has KB section
    admin_html = os.path.join(os.path.dirname(__file__), 'client_ui/public/admin.html')
    if os.path.exists(admin_html):
        with open(admin_html, 'r', encoding='utf-8') as f:
            content = f.read()
            if 'knowledge-base' in content and 'admin-knowledge-base.js' in content:
                print_status("UI", True, "admin.html includes KB section and script")
            else:
                print_status("UI", False, "admin.html missing KB integration")
                all_passed = False

    # Check 7: Admin API Endpoints
    print_header("7. Admin API Endpoints Check")
    admin_api_path = os.path.join(os.path.dirname(__file__), 'actions', 'admin_api.py')
    if os.path.exists(admin_api_path):
        with open(admin_api_path, 'r') as f:
            content = f.read()
            endpoints = [
                '/api/admin/kb/status',
                '/api/admin/kb/refresh',
                '/api/admin/kb/articles',
                '/api/admin/kb/search'
            ]

            found_endpoints = 0
            for endpoint in endpoints:
                if f"'{endpoint}'" in content or f'"{endpoint}"' in content:
                    found_endpoints += 1

            if found_endpoints == len(endpoints):
                print_status("API", True, f"All {len(endpoints)} KB endpoints found in admin_api.py")
            else:
                print_status("API", False, f"Only {found_endpoints}/{len(endpoints)} KB endpoints found")
                all_passed = False

    # Final Summary
    print_header("VERIFICATION SUMMARY")

    if all_passed:
        print("\n✓ All checks passed!")
        print("\nNext steps:")
        print("  1. If services are not running, run: restart_kb_services.bat")
        print("  2. Open http://localhost/admin.html")
        print("  3. Click 'Knowledge Base' tab")
        print("  4. Verify article count and test search")
    else:
        print("\n✗ Some checks failed!")
        print("\nPlease review the errors above and:")
        print("  1. Install missing dependencies")
        print("  2. Verify all files are in place")
        print("  3. Run restart_kb_services.bat")

    print("\n" + "="*60 + "\n")

    return 0 if all_passed else 1

if __name__ == '__main__':
    sys.exit(main())
