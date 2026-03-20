import os
import sys

# Добавляем путь к текущей директории скрипта, чтобы импорты работали из любого места
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal, ExerciseCatalog

def populate_chest():
    db = SessionLocal()
    chest_exercises = [
        "Жим штанги в наклоне",
        "Жим в Смите в наклоне",
        "Жим гантелей в наклоне",
        "Жим штанги лежа",
        "Жим лежа в Смите",
        "Жим гантелей лежа",
        "Отжимания на брусьях с акцентом на грудь",
        "Жим в Хаммере на верх груди",
        "Жим в Хаммере на низ груди",
        "Жим вниз в тренажере",
        "Сведение в Пек-Дек на верх груди",
        "Сведение в Пек-Дек на низ груди",
        "Сведение в кроссовере стоя",
        "Сведение в кроссовере лежа на наклонной скамье",
        "Сведение гантелей лежа",
        "Пуловер с гантелью на грудь"
    ]
    
    existing = db.query(ExerciseCatalog.name).filter(ExerciseCatalog.category == "ГРУДЬ").all()
    existing_names = [e[0] for e in existing]
    
    added_count = 0
    for name in chest_exercises:
        if name not in existing_names:
            db.add(ExerciseCatalog(name=name, category="ГРУДЬ"))
            added_count += 1
            
    db.commit()
    db.close()
    print(f"Добавлено {added_count} новых упражнений в категорию ГРУДЬ")

if __name__ == "__main__":
    populate_chest()
