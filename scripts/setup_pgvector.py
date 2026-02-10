"""
Setup pgvector for semantic KB search
1. Enable pgvector extension
2. Create kb_chunks table with vector column
3. Process existing articles into chunks with embeddings
"""
import sys
import os
import re

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from sentence_transformers import SentenceTransformer
from common.config_manager import get_db_config

# Embedding model - 384 dimensions
MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
CHUNK_SIZE = 200  # words per chunk

def get_connection():
    """Get database connection"""
    db_config = get_db_config()
    return psycopg2.connect(
        host=db_config['host'],
        port=db_config['port'],
        database=db_config['database'],
        user=db_config['user'],
        password=db_config['password']
    )

def setup_pgvector():
    """Enable pgvector extension and create kb_chunks table"""
    conn = get_connection()
    cursor = conn.cursor()
    
    print("1. Enabling pgvector extension...")
    try:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        conn.commit()
        print("   ✓ pgvector extension enabled")
    except Exception as e:
        print(f"   ✗ Error: {e}")
        print("   Note: You may need to install pgvector system package first")
        print("   Run: CREATE EXTENSION vector; in psql as superuser")
        return False
    
    print("2. Creating kb_chunks table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS kb_chunks (
            id SERIAL PRIMARY KEY,
            article_id VARCHAR(100),
            chunk_index INT,
            title VARCHAR(255),
            content TEXT,
            embedding vector(384),
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)
    conn.commit()
    print("   ✓ kb_chunks table created")
    
    print("3. Creating vector index...")
    try:
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx 
            ON kb_chunks USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        """)
        conn.commit()
        print("   ✓ Vector index created")
    except Exception as e:
        # ivfflat needs at least some data first, we'll create it later
        print(f"   Note: Index will be created after data insert")
    
    cursor.close()
    conn.close()
    return True

def chunk_text(text, chunk_size=CHUNK_SIZE):
    """Split text into chunks of approximately chunk_size words"""
    words = text.split()
    chunks = []
    
    for i in range(0, len(words), chunk_size):
        chunk = ' '.join(words[i:i + chunk_size])
        if len(chunk) > 50:  # Only include meaningful chunks
            chunks.append(chunk)
    
    return chunks

def process_articles():
    """Load articles, chunk them, generate embeddings, and store"""
    conn = get_connection()
    cursor = conn.cursor()
    
    print("\n4. Loading embedding model...")
    model = SentenceTransformer(MODEL_NAME)
    print(f"   ✓ Loaded {MODEL_NAME}")
    
    print("\n5. Loading articles from kb_articles...")
    cursor.execute("SELECT id, title, content, category FROM kb_articles")
    articles = cursor.fetchall()
    print(f"   Found {len(articles)} articles")
    
    print("\n6. Processing articles into chunks...")
    # Clear existing chunks
    cursor.execute("DELETE FROM kb_chunks")
    conn.commit()
    
    total_chunks = 0
    for article_id, title, content, category in articles:
        if not content:
            continue
            
        # Chunk the content
        chunks = chunk_text(content)
        
        for i, chunk_text_content in enumerate(chunks):
            # Generate embedding
            embedding = model.encode(chunk_text_content)
            embedding_list = embedding.tolist()
            
            # Insert chunk with embedding
            cursor.execute("""
                INSERT INTO kb_chunks (article_id, chunk_index, title, content, embedding)
                VALUES (%s, %s, %s, %s, %s)
            """, (article_id, i, title, chunk_text_content, embedding_list))
            
            total_chunks += 1
        
        if total_chunks % 50 == 0:
            print(f"   Processed {total_chunks} chunks...")
            conn.commit()
    
    conn.commit()
    print(f"   ✓ Created {total_chunks} chunks with embeddings")
    
    print("\n7. Creating/updating vector index...")
    try:
        cursor.execute("DROP INDEX IF EXISTS kb_chunks_embedding_idx;")
        cursor.execute("""
            CREATE INDEX kb_chunks_embedding_idx 
            ON kb_chunks USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        """)
        conn.commit()
        print("   ✓ Vector index created")
    except Exception as e:
        print(f"   Index creation note: {e}")
    
    cursor.close()
    conn.close()
    return total_chunks

def test_search(query="how to reset password"):
    """Test vector similarity search"""
    conn = get_connection()
    cursor = conn.cursor()
    
    print(f"\n8. Testing search: '{query}'")
    
    model = SentenceTransformer(MODEL_NAME)
    query_embedding = model.encode(query).tolist()
    
    cursor.execute("""
        SELECT title, content, 1 - (embedding <=> %s::vector) as similarity
        FROM kb_chunks
        ORDER BY embedding <=> %s::vector
        LIMIT 3
    """, (query_embedding, query_embedding))
    
    results = cursor.fetchall()
    print(f"   Top 3 results:")
    for title, content, similarity in results:
        print(f"   - [{similarity:.3f}] {title[:50]}...")
        print(f"     {content[:100]}...")
    
    cursor.close()
    conn.close()

def main():
    print("="*60)
    print("pgvector Semantic Search Setup")
    print("="*60 + "\n")
    
    if not setup_pgvector():
        print("\nSetup failed. Please ensure pgvector is installed in PostgreSQL.")
        return
    
    total_chunks = process_articles()
    
    if total_chunks > 0:
        test_search("how to create a document")
        test_search("what is filing and indexing")
    
    print("\n" + "="*60)
    print(f"Setup complete! {total_chunks} chunks ready for semantic search.")
    print("="*60)

if __name__ == "__main__":
    main()
