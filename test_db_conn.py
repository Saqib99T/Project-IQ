import psycopg2
from actions.config_manager import get_db_config

def test_connection():
    config = get_db_config()
    print(f"Attempting to connect with config: {config}")
    try:
        conn = psycopg2.connect(**config)
        print("Successfully connected to the database!")
        
        cursor = conn.cursor()
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        tables = cursor.fetchall()
        print(f"Tables found: {[t[0] for t in tables]}")
        
        conn.close()
    except Exception as e:
        print(f"Error connecting to database: {e}")

if __name__ == "__main__":
    test_connection()
