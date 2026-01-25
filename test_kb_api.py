#!/usr/bin/env python3
"""
Test Knowledge Base API endpoints
Run this after services are started to verify KB is working
"""

import requests
import json
import sys

BASE_URL = "http://localhost"

def print_header(title):
    print("\n" + "="*60)
    print(f"  {title}")
    print("="*60)

def test_kb_status():
    """Test /api/admin/kb/status endpoint"""
    print_header("TEST 1: KB Status Endpoint")

    try:
        response = requests.get(f"{BASE_URL}/api/admin/kb/status", timeout=5)
        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                status = data.get('status', {})
                print(f"✓ Success!")
                print(f"  - Article Count: {status.get('article_count', 0)}")
                print(f"  - Source: {status.get('source', 'unknown')}")
                print(f"  - Last Refresh: {status.get('last_refresh', 'N/A')}")

                model_info = status.get('model_info')
                if model_info:
                    print(f"  - Model: {model_info.get('model_name', 'N/A')}")
                    print(f"  - Dimensions: {model_info.get('embedding_dimension', 'N/A')}")
                    print(f"  - Cache Size: {status.get('cache_size_mb', 0):.2f} MB")

                return True
            else:
                print(f"✗ API returned success=False: {data.get('error')}")
                return False
        else:
            print(f"✗ HTTP Error: {response.status_code}")
            print(f"Response: {response.text}")
            return False

    except requests.exceptions.ConnectionError:
        print("✗ Connection Error: Admin API not running on port 80")
        print("  Run: start_services.bat or restart_kb_services.bat")
        return False
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def test_kb_search():
    """Test /api/admin/kb/search endpoint"""
    print_header("TEST 2: KB Search Endpoint")

    test_queries = [
        "password reset",
        "printer not working",
        "email configuration"
    ]

    for query in test_queries:
        print(f"\nSearching for: '{query}'")
        try:
            response = requests.post(
                f"{BASE_URL}/api/admin/kb/search",
                json={"query": query},
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    results = data.get('results', [])
                    print(f"  ✓ Found {len(results)} results")

                    for i, result in enumerate(results[:3], 1):
                        article = result.get('article', {})
                        scores = result.get('scores', {})
                        print(f"    {i}. {article.get('title', 'N/A')}")
                        print(f"       Score: {scores.get('final_score', 0):.3f} "
                              f"(Semantic: {scores.get('semantic_score', 0):.3f}, "
                              f"Keyword: {scores.get('keyword_score', 0):.3f})")
                else:
                    print(f"  ✗ Search failed: {data.get('error')}")
            else:
                print(f"  ✗ HTTP Error: {response.status_code}")

        except Exception as e:
            print(f"  ✗ Error: {e}")

def test_kb_articles():
    """Test /api/admin/kb/articles endpoint"""
    print_header("TEST 3: KB Articles Endpoint")

    try:
        response = requests.get(
            f"{BASE_URL}/api/admin/kb/articles?page=1&limit=5",
            timeout=5
        )

        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                articles = data.get('articles', [])
                total = data.get('total', 0)
                print(f"✓ Success!")
                print(f"  - Total Articles: {total}")
                print(f"  - Showing: {len(articles)} articles")

                for i, article in enumerate(articles, 1):
                    print(f"    {i}. {article.get('title', 'N/A')} ({article.get('category', 'N/A')})")

                return True
            else:
                print(f"✗ API returned success=False: {data.get('error')}")
                return False
        else:
            print(f"✗ HTTP Error: {response.status_code}")
            return False

    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def test_manual_refresh():
    """Test /api/admin/kb/refresh endpoint"""
    print_header("TEST 4: Manual Refresh Endpoint")

    print("WARNING: This will trigger a full KB cache refresh")
    print("This may take 5-10 seconds...")

    try:
        response = input("\nProceed with refresh test? (y/n): ")
        if response.lower() != 'y':
            print("Skipped")
            return True

        print("\nTriggering refresh...")
        response = requests.post(f"{BASE_URL}/api/admin/kb/refresh", timeout=30)

        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                print(f"✓ Refresh successful!")
                print(f"  - {data.get('message', 'Done')}")
                status = data.get('status', {})
                print(f"  - Article Count: {status.get('article_count', 0)}")
                return True
            else:
                print(f"✗ Refresh failed: {data.get('message')}")
                return False
        else:
            print(f"✗ HTTP Error: {response.status_code}")
            return False

    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def main():
    print_header("KNOWLEDGE BASE API TESTS")

    results = []

    # Test 1: Status
    results.append(("KB Status", test_kb_status()))

    # Test 2: Search
    results.append(("KB Search", test_kb_search()))

    # Test 3: Articles
    results.append(("KB Articles", test_kb_articles()))

    # Test 4: Refresh (optional)
    results.append(("Manual Refresh", test_manual_refresh()))

    # Summary
    print_header("TEST SUMMARY")

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        symbol = "✓" if result else "✗"
        print(f"{symbol} {name}")

    print(f"\nPassed: {passed}/{total}")

    if passed == total:
        print("\n✓ All API tests passed!")
        print("\nKnowledge Base integration is working correctly!")
        print("\nNext steps:")
        print("  - Open http://localhost/admin.html")
        print("  - Navigate to 'Knowledge Base' tab")
        print("  - Explore the UI and test search functionality")
    else:
        print("\n✗ Some tests failed!")
        print("\nTroubleshooting:")
        print("  1. Verify services are running: netstat -ano | findstr \"80 5055\"")
        print("  2. Check Action Server logs for KB cache errors")
        print("  3. Verify GLPI is accessible: http://localhost:8083/apirest.php")
        print("  4. Re-run: restart_kb_services.bat")

    print("\n" + "="*60 + "\n")

    return 0 if passed == total else 1

if __name__ == '__main__':
    sys.exit(main())
