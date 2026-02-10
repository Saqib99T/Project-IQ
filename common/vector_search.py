"""
Vector Search Module for KB
Uses sentence-transformers + numpy for in-memory semantic search
Works without pgvector PostgreSQL extension
"""
import os
import sys
import json
import numpy as np
from typing import List, Dict, Tuple, Optional

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from sentence_transformers import SentenceTransformer

# Embedding model
MODEL_NAME = "all-MiniLM-L6-v2"
CHUNK_SIZE = 150  # words per chunk - smaller for focused responses
CACHE_FILE = os.path.join(os.path.dirname(__file__), "kb_embeddings_cache.json")

# Global cache
_model = None
_chunks = []
_embeddings = None

def get_model():
    """Lazy load the embedding model"""
    global _model
    if _model is None:
        print("Loading embedding model...")
        _model = SentenceTransformer(MODEL_NAME)
    return _model

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE) -> List[str]:
    """Split text into chunks of approximately chunk_size words"""
    if not text:
        return []
    
    words = text.split()
    chunks = []
    
    for i in range(0, len(words), chunk_size):
        chunk = ' '.join(words[i:i + chunk_size])
        if len(chunk) > 30:  # Only include meaningful chunks
            chunks.append(chunk)
    
    return chunks

def load_and_process_articles():
    """Load articles from database and create chunks with embeddings"""
    global _chunks, _embeddings
    
    from common.conversation_db import _get_connection, _release_connection
    
    conn = _get_connection()
    cursor = conn.cursor()
    
    print("Loading articles from database...")
    cursor.execute("SELECT id, title, content, category FROM kb_articles")
    articles = cursor.fetchall()
    
    cursor.close()
    _release_connection(conn)
    
    print(f"Processing {len(articles)} articles into chunks...")
    
    model = get_model()
    all_chunks = []
    
    for article_id, title, content, category in articles:
        if not content:
            continue
        
        text_chunks = chunk_text(content)
        
        for i, chunk_text_content in enumerate(text_chunks):
            all_chunks.append({
                "article_id": article_id,
                "title": title,
                "content": chunk_text_content,
                "category": category or "General",
                "chunk_index": i
            })
    
    print(f"Created {len(all_chunks)} chunks, generating embeddings...")
    
    # Generate embeddings for all chunks
    chunk_texts = [c["content"] for c in all_chunks]
    embeddings = model.encode(chunk_texts, show_progress_bar=True)
    
    _chunks = all_chunks
    _embeddings = embeddings
    
    # Save to cache
    save_cache()
    
    print(f"Done! {len(_chunks)} chunks ready for semantic search.")
    return len(_chunks)

def save_cache():
    """Save chunks and embeddings to cache file"""
    global _chunks, _embeddings
    
    cache_data = {
        "chunks": _chunks,
        "embeddings": _embeddings.tolist() if _embeddings is not None else []
    }
    
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache_data, f)
    
    print(f"Cache saved to {CACHE_FILE}")

def load_cache() -> bool:
    """Load chunks and embeddings from cache file"""
    global _chunks, _embeddings
    
    if not os.path.exists(CACHE_FILE):
        return False
    
    try:
        with open(CACHE_FILE, 'r') as f:
            cache_data = json.load(f)
        
        _chunks = cache_data.get("chunks", [])
        embeddings_list = cache_data.get("embeddings", [])
        _embeddings = np.array(embeddings_list) if embeddings_list else None
        
        print(f"Loaded {len(_chunks)} chunks from cache")
        return len(_chunks) > 0
    except Exception as e:
        print(f"Error loading cache: {e}")
        return False

def ensure_loaded():
    """Ensure chunks and embeddings are loaded"""
    global _chunks, _embeddings
    
    if not _chunks or _embeddings is None:
        if not load_cache():
            load_and_process_articles()

def search(query: str, top_k: int = 1) -> List[Dict]:
    """
    Search for chunks most similar to the query
    
    Args:
        query: Search query text
        top_k: Number of results to return (default 1 for focused response)
    
    Returns:
        List of matching chunks with similarity scores
    """
    ensure_loaded()
    
    if not _chunks or _embeddings is None:
        return []
    
    model = get_model()
    query_embedding = model.encode(query)
    
    # Calculate cosine similarity
    similarities = np.dot(_embeddings, query_embedding) / (
        np.linalg.norm(_embeddings, axis=1) * np.linalg.norm(query_embedding)
    )
    
    # Get top-k indices
    top_indices = np.argsort(similarities)[-top_k:][::-1]
    
    results = []
    for idx in top_indices:
        chunk = _chunks[idx].copy()
        chunk["similarity"] = float(similarities[idx])
        results.append(chunk)
    
    return results

def search_single(query: str) -> Optional[Dict]:
    """
    Search and return only the single best matching chunk
    For focused, single-section responses
    """
    results = search(query, top_k=1)
    return results[0] if results else None

# CLI for testing
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="KB Vector Search")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild embeddings cache")
    parser.add_argument("--query", type=str, help="Search query")
    args = parser.parse_args()
    
    if args.rebuild:
        load_and_process_articles()
    
    if args.query:
        results = search(args.query, top_k=3)
        print(f"\nSearch results for: '{args.query}'")
        print("=" * 60)
        for r in results:
            print(f"[{r['similarity']:.3f}] {r['title']}")
            print(f"  {r['content'][:200]}...")
            print()
    
    if not args.rebuild and not args.query:
        # Interactive mode
        ensure_loaded()
        print("\nKB Vector Search Ready!")
        print(f"Loaded {len(_chunks)} chunks")
        print("\nType a query to search (or 'quit' to exit):")
        
        while True:
            query = input("\n> ").strip()
            if query.lower() in ('quit', 'exit', 'q'):
                break
            
            if query:
                result = search_single(query)
                if result:
                    print(f"\n[Score: {result['similarity']:.3f}]")
                    print(f"Title: {result['title']}")
                    print(f"\n{result['content']}")
                else:
                    print("No results found")
