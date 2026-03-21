import sqlite3
import os

def migrate():
    db_path = "forma.db"
    if not os.path.exists(db_path):
        print(f"Файл базы данных {db_path} не найден. Проверьте путь.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Проверяем наличие колонки timestamp в таблице weight_entries
        cursor.execute("PRAGMA table_info(weight_entries)")
        columns = [column[1] for column in cursor.fetchall()]

        if "timestamp" not in columns:
            print("Добавляю колонку 'timestamp' в таблицу weight_entries...")
            cursor.execute("ALTER TABLE weight_entries ADD COLUMN timestamp TEXT")
            
            # Заполняем пустые значения из колонки date
            cursor.execute("UPDATE weight_entries SET timestamp = date WHERE timestamp IS NULL")
            print("Колонка добавлена и заполнена значениями из 'date'.")
        else:
            print("Колонка 'timestamp' уже существует.")

        conn.commit()
        print("Миграция успешно завершена!")
    except Exception as e:
        print(f"Ошибка при миграции: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
