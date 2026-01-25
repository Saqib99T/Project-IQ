
import logging
import sys
import os

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add current directory to path
sys.path.append(os.getcwd())

from actions.kb_cache_manager import kb_cache
from actions.config_manager import get_glpi_config

def test_search():
    print("--- 1. Testing Connection & Cache Refresh ---")
    
    # Check config
    config = get_glpi_config()
    print(f"GLPI URL: {config.get('api_url')}")
    
    # Force refresh
    print("Refreshing cache from GLPI...")
    success = kb_cache.refresh_cache()
    
    if not success:
        print("❌ Cache refresh failed!")
        # Print cache info anyway to see if we have JSON fallback
        info = kb_cache.get_cache_info()
        print(f"Cache Status: {info}")
        if info['article_count'] == 0:
            return
            
    # Get cache info
    info = kb_cache.get_cache_info()
    print(f"✅ Cache refreshed. Articles: {info['article_count']}")
    
    if info['article_count'] > 0:
        articles = kb_cache.get_all_articles()
        print(f"First article title: {articles[0].get('title')}")
        print(f"First article keywords: {articles[0].get('keywords')}")

    print("\n--- 2. Interactive Search Test ---")
    queries = [
        "reset password",
        "vpn connection",
        "printer issue",
        "how to create ticket",
        "internet slow"
    ]
    
    for q in queries:
        print(f"\nQUERY: '{q}'")
        results = kb_cache.search_articles(q)
        print(f"Found {len(results)} matches")
        for i, res in enumerate(results):
            art = res['article']
            print(f"  {i+1}. [{res['score']:.2f}] {art['title']} (Source: {res['source']})")
            print(f"     Sem: {res.get('semantic_score', 0):.2f}, Key: {res.get('keyword_score', 0):.2f}")

if __name__ == "__main__":
    test_search()
