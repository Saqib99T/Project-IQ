"""Test database connection script"""
import psycopg2
from actions.config_manager import get_db_config

def test_connection():
    """Test connection to PostgreSQL database."""
    print("Testing database connection...")

    # Get database config
    db_config = get_db_config()
    print(f"\nDatabase Configuration:")
    print(f"  Host: {db_config['host']}")
    print(f"  Port: {db_config['port']}")
    print(f"  Database: {db_config['database']}")
    print(f"  User: {db_config['user']}")
    print(f"  Password: {'*' * len(str(db_config['password']))}")

    # Try to connect
    try:
        print(f"\nAttempting to connect to database '{db_config['database']}'...")
        conn = psycopg2.connect(**db_config)
        print("[SUCCESS] Connection successful!")

        # Test query
        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"\nPostgreSQL Version: {version}")

        # List tables
        cursor.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name;
        """)
        tables = cursor.fetchall()
        if tables:
            print(f"\nExisting tables in '{db_config['database']}':")
            for table in tables:
                print(f"  - {table[0]}")
        else:
            print(f"\nNo tables found in '{db_config['database']}' database.")

        cursor.close()
        conn.close()
        return True

    except psycopg2.OperationalError as e:
        print(f"[FAILED] Connection failed: {e}")

        # Try to list all databases
        try:
            print(f"\nAttempting to connect to 'postgres' database to list all databases...")
            temp_config = db_config.copy()
            temp_config['database'] = 'postgres'
            conn = psycopg2.connect(**temp_config)
            cursor = conn.cursor()
            cursor.execute("SELECT datname FROM pg_database WHERE datistemplate = false;")
            databases = cursor.fetchall()
            print("\nAvailable databases:")
            for db in databases:
                print(f"  - {db[0]}")
            cursor.close()
            conn.close()
        except Exception as list_error:
            print(f"Could not list databases: {list_error}")

        return False
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")
        return False

if __name__ == '__main__':
    test_connection()
