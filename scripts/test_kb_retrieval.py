
import sys
import os
import asyncio
import logging

# Add project root to path
sys.path.append(os.getcwd())

# Mock logging to avoid clutter
logging.basicConfig(level=logging.INFO)

async def test_retrieval():
    print("--- Initializing KBCacheManager ---")
    
    # We need to make sure we're in the right directory for relative paths to work
    # actions.kb_cache_manager expects data/knowledge_base relative to project root usually
    # or relative to itself. The code uses os.path.dirname(__file__) which is good.
    
    from admin.api.kb_cache_manager import KBCacheManager
    
    kb = KBCacheManager()
    
    # Force reload to pick up new files immediately without waiting for thread
    print("--- Refreshing Cache ---")
    await kb.refresh_cache_async()
    
    print(f"Total Articles: {len(kb._cache)}")
    print(f"Total Sections: {len(kb._section_cache)}")
    
    if not kb._section_cache:
        print("❌ ERROR: No sections found in cache. Chunking might have failed or is disabled.")
        return

    # specific query for a generated section
    # Article 1, Section 3
    query = "Advanced Hardware Topic 3"
    print(f"\n--- Searching for: '{query}' ---")
    
    results = kb.search_sections(query)
    
    if not results:
        print("❌ ERROR: No results found.")
        return
        
    top_result = results[0]
    section = top_result['section']
    score = top_result['score']
    
    print(f"✅ Top Result Score: {score}")
    print(f"Title: {section.get('title')}")
    print(f"Article ID: {section.get('article_id')}")
    print(f"Content Preview: {section.get('content')[:100]}...")
    
    article_title = "Comprehensive Guide to Hardware Troubleshooting - Part 1"
    section_title_snippet = "Advanced Hardware Topic 3"
    
    if article_title in section.get('article_title', '') and section_title_snippet in section.get('title', ''):
        print("\n✅ SUCCESS: Correct section retrieved!")
    else:
        print(f"\n❌ FAILED: retrieved wrong section. Got {section.get('title')} from {section.get('article_title')}")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(test_retrieval())
