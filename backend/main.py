from fastapi import FastAPI, Depends, HTTPException, Query, Body
from openai import OpenAI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict
from contextlib import asynccontextmanager
try:
    from . import database as db
except (ImportError, ValueError):
    import database as db
import asyncio
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
import os
from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request
from starlette.responses import RedirectResponse
try:
    from .bot import bot, dp, send_notification
except (ImportError, ValueError):
    from bot import bot, dp, send_notification
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Настройка планировщика
scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Запускаем планировщик
    scheduler.start()
    # Запускаем бота в фоновом режиме
    asyncio.create_task(dp.start_polling(bot))
    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

# Разрешаем CORS для локальной разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Инициализация БД
db.init_db()

# Схемы Pydantic
class SetBase(BaseModel):
    weight: float
    reps: int

class SetCreate(SetBase):
    exercise_id: int

class SetOut(SetBase):
    id: int
    exercise_id: int
    model_config = ConfigDict(from_attributes=True)

class ExerciseBase(BaseModel):
    name: str

class ExerciseCreate(BaseModel):
    name: str

class ExerciseOut(ExerciseBase):
    id: int
    workout_id: int
    sets: List[SetOut] = []
    model_config = ConfigDict(from_attributes=True)

class WorkoutOut(BaseModel):
    id: int
    telegram_id: int
    date: str
    exercises: List[ExerciseOut] = []

class ExerciseCatalogOut(BaseModel):
    id: int
    name: str
    category: str
    model_config = ConfigDict(from_attributes=True)

class UserFavoriteCreate(BaseModel):
    name: str

# Dependency
def get_db():
    database = db.SessionLocal()
    try:
        yield database
    finally:
        database.close()

@app.get("/exercise-catalog", response_model=List[ExerciseCatalogOut])
def get_exercise_catalog(database: Session = Depends(get_db)):
    return database.query(db.ExerciseCatalog).all()

@app.get("/user/favorites", response_model=List[str])
def get_user_favorites(telegram_id: int, database: Session = Depends(get_db)):
    favs = database.query(db.UserFavorite).filter(db.UserFavorite.user_id == telegram_id).all()
    return [f.exercise_name for f in favs]

@app.post("/user/favorites")
def add_favorite(telegram_id: int, name: str = Body(..., embed=True), database: Session = Depends(get_db)):
    # Проверяем, нет ли уже в избранном
    exists = database.query(db.UserFavorite).filter(
        db.UserFavorite.user_id == telegram_id,
        db.UserFavorite.exercise_name == name
    ).first()
    if not exists:
        fav = db.UserFavorite(user_id=telegram_id, exercise_name=name)
        database.add(fav)
        database.commit()
    return {"status": "ok"}

@app.delete("/user/favorites")
def remove_favorite(telegram_id: int, name: str, database: Session = Depends(get_db)):
    database.query(db.UserFavorite).filter(
        db.UserFavorite.user_id == telegram_id,
        db.UserFavorite.exercise_name == name
    ).delete()
    database.commit()
    return {"status": "ok"}

class UserLogin(BaseModel):
    telegram_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    photo_url: Optional[str] = None

@app.get("/workouts", response_model=List[ExerciseOut])
def get_workout(date: str, telegram_id: int, database: Session = Depends(get_db)):
    # Проверяем или создаем пользователя
    user = database.query(db.User).filter(db.User.telegram_id == telegram_id).first()
    if not user:
        user = db.User(telegram_id=telegram_id)
        database.add(user)
        database.commit()

    # Ищем тренировку на эту дату
    workout = database.query(db.Workout).filter(
        db.Workout.telegram_id == telegram_id,
        db.Workout.date == date
    ).first()

    if not workout:
        return []

    return workout.exercises

@app.post("/auth/login")
def auth_login(data: UserLogin, database: Session = Depends(get_db)):
    user = database.query(db.User).filter(db.User.telegram_id == data.telegram_id).first()
    if not user:
        user = db.User(
            telegram_id=data.telegram_id,
            username=data.username,
            first_name=data.first_name,
            last_name=data.last_name,
            photo_url=data.photo_url
        )
        database.add(user)
    else:
        if data.username is not None: user.username = data.username
        if data.first_name is not None: user.first_name = data.first_name
        if data.last_name is not None: user.last_name = data.last_name
        if data.photo_url is not None: user.photo_url = data.photo_url

    database.commit()
    return {"status": "ok"}

@app.post("/exercises", response_model=ExerciseOut)
def create_exercise(
    name: str = Body(..., embed=True), 
    telegram_id: int = Query(...), 
    date: str = Query(...), 
    database: Session = Depends(get_db)
):
    # Убеждаемся, что тренировка существует
    workout = database.query(db.Workout).filter(
        db.Workout.telegram_id == telegram_id,
        db.Workout.date == date
    ).first()

    if not workout:
        workout = db.Workout(telegram_id=telegram_id, date=date)
        database.add(workout)
        database.commit()
        database.refresh(workout)

    db_exercise = db.Exercise(name=name, workout_id=workout.id)
    database.add(db_exercise)
    database.commit()
    database.refresh(db_exercise)
    return db_exercise

@app.delete("/exercises/{exercise_id}")
def delete_exercise(exercise_id: int, database: Session = Depends(get_db)):
    db_exercise = database.query(db.Exercise).filter(db.Exercise.id == exercise_id).first()
    if not db_exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    database.delete(db_exercise)
    database.commit()
    return {"status": "success"}

class ExerciseUpdate(BaseModel):
    name: str
    sets: List[SetBase]

@app.put("/exercises/{exercise_id}", response_model=ExerciseOut)
def update_exercise(exercise_id: int, data: ExerciseUpdate, database: Session = Depends(get_db)):
    db_exercise = database.query(db.Exercise).filter(db.Exercise.id == exercise_id).first()
    if not db_exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")
    
    # Обновляем имя
    db_exercise.name = data.name
    
    # Синхронизируем подходы
    # Простейший путь: удалить старые и добавить новые
    database.query(db.Set).filter(db.Set.exercise_id == exercise_id).delete()
    for s in data.sets:
        db_set = db.Set(exercise_id=exercise_id, weight=s.weight, reps=s.reps)
        database.add(db_set)
    
    database.commit()
    database.refresh(db_exercise)
    return db_exercise

@app.post("/sets", response_model=SetOut)
def create_set(set_data: SetCreate, database: Session = Depends(get_db)):
    db_set = db.Set(
        exercise_id=set_data.exercise_id,
        weight=set_data.weight,
        reps=set_data.reps
    )
    database.add(db_set)
    database.commit()
    database.refresh(db_set)
    return db_set

class WeightEntryBase(BaseModel):
    weight: float
    date: str
    timestamp: str

class WeightEntryCreate(WeightEntryBase):
    pass

class WeightEntryOut(WeightEntryBase):
    id: int
    user_id: int
    model_config = ConfigDict(from_attributes=True)



@app.get("/weights", response_model=List[WeightEntryOut])
def get_weights(telegram_id: int, database: Session = Depends(get_db)):
    user = database.query(db.User).filter(db.User.telegram_id == telegram_id).first()
    if not user:
        return []
    return database.query(db.WeightEntry).filter(db.WeightEntry.user_id == user.telegram_id).order_by(db.WeightEntry.id.desc()).all()

@app.post("/weights", response_model=WeightEntryOut)
def add_weight(entry: WeightEntryCreate, telegram_id: int, database: Session = Depends(get_db)):
    user = database.query(db.User).filter(db.User.telegram_id == telegram_id).first()
    if not user:
        user = db.User(telegram_id=telegram_id)
        database.add(user)
        database.commit()
        database.refresh(user)

    db_entry = db.WeightEntry(
        user_id=user.telegram_id,
        weight=entry.weight,
        date=entry.date,
        timestamp=entry.timestamp
    )
    database.add(db_entry)
    database.commit()
    database.refresh(db_entry)
    return db_entry

@app.delete("/weights/{weight_id}")
def delete_weight(weight_id: int, database: Session = Depends(get_db)):
    db_entry = database.query(db.WeightEntry).filter(db.WeightEntry.id == weight_id).first()
    if not db_entry:
        raise HTTPException(status_code=404, detail="Weight entry not found")
    database.delete(db_entry)
    database.commit()
    return {"status": "success"}

@app.get("/ai/insight")
async def get_ai_insight(telegram_id: int, database: Session = Depends(get_db)):
    # 1. Собираем данные: последние тренировки и веса
    user = database.query(db.User).filter(db.User.telegram_id == telegram_id).first()
    if not user:
        return {"insight": "Добро пожаловать в Forma! Начни тренироваться, чтобы получить советы от AI."}

    # Последние 3 тренировки
    workouts = database.query(db.Workout).filter(db.Workout.telegram_id == telegram_id).order_by(db.Workout.date.desc()).limit(3).all()
    workout_summary = []
    for w in workouts:
        exercises = [ex.name for ex in w.exercises]
        workout_summary.append(f"{w.date}: {', '.join(exercises)}")

    # Последние 3 записи веса
    weights = database.query(db.WeightEntry).filter(db.WeightEntry.user_id == telegram_id).order_by(db.WeightEntry.date.desc()).limit(3).all()
    weight_summary = [f"{w.date}: {w.weight}kg" for w in weights]

    # 2. Формируем промпт
    prompt = f"Ты - фитнес-коуч. Дай ОДИН очень короткий (максимум 10 слов), мотивирующий или практический совет на русском языке, основываясь на данных пользователя:\n"
    if workout_summary:
        prompt += f"Последние тренировки: {'; '.join(workout_summary)}\n"
    if weight_summary:
        prompt += f"Последние замеры веса: {'; '.join(weight_summary)}\n"
    prompt += "Совет должен быть простым и дружелюбным."

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=50,
            temperature=0.7
        )
        insight = response.choices[0].message.content.strip()
        return {"insight": insight}
    except Exception as e:
        print(f"OpenAI error: {e}")
        return {"insight": "Тренируйся регулярно — и результат не заставит себя ждать!"}

@app.delete("/sets/{set_id}")
def delete_set(set_id: int, database: Session = Depends(get_db)):
    db_set = database.query(db.Set).filter(db.Set.id == set_id).first()
    if not db_set:
        raise HTTPException(status_code=404, detail="Set not found")
    database.delete(db_set)
    database.commit()
    return {"status": "success"}

@app.get("/user/streak")
def get_streak(telegram_id: int, database: Session = Depends(get_db)):
    # Получаем все уникальные даты тренировок пользователя
    workout_dates = database.query(db.Workout.date).filter(
        db.Workout.telegram_id == telegram_id
    ).distinct().order_by(db.Workout.date.desc()).all()
    
    dates = [d[0] for d in workout_dates]
    if not dates:
        return {"streak": 0, "last_7_days": [False] * 7}
    
    today = datetime.now().date()
    yesterday = today - timedelta(days=1)
    date_set = set(dates)
    
    # Расчет серии (streak)
    streak = 0
    if today.isoformat() in date_set or yesterday.isoformat() in date_set:
        curr = today if today.isoformat() in date_set else yesterday
        while curr.isoformat() in date_set:
            streak += 1
            curr -= timedelta(days=1)
    
    # Активность за последние 7 дней (для точек на дашборде)
    # [6 дней назад, ..., сегодня]
    last_7_days = []
    for i in range(6, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        last_7_days.append(d in date_set)
        
    return {"streak": streak, "last_7_days": last_7_days}

@app.get("/init-app")
def init_app(telegram_id: int, date: str, database: Session = Depends(get_db)):
    # 1. Workouts for specific date
    workouts = database.query(db.Workout).filter(
        db.Workout.telegram_id == telegram_id,
        db.Workout.date == date
    ).all()
    
    # 2. Weights (all)
    weights = database.query(db.WeightEntry).filter(
        db.WeightEntry.user_id == telegram_id
    ).order_by(db.WeightEntry.date.desc()).all()
    
    # 3. Exercise Catalog
    catalog = database.query(db.ExerciseCatalog).all()
    
    # 4. Favorites 
    favorites = database.query(db.UserFavorite).filter(
        db.UserFavorite.telegram_id == telegram_id
    ).all()
    fav_names = [f.name for f in favorites]
    
    # 5. Streak 
    workout_dates = database.query(db.Workout.date).filter(
        db.Workout.telegram_id == telegram_id
    ).distinct().order_by(db.Workout.date.desc()).all()
    
    dates = [d[0] for d in workout_dates]
    streak = 0
    last_7_days = [False] * 7
    if dates:
        today = datetime.now().date()
        yesterday = today - timedelta(days=1)
        date_set = set(dates)
        if today.isoformat() in date_set or yesterday.isoformat() in date_set:
            curr = today if today.isoformat() in date_set else yesterday
            while curr.isoformat() in date_set:
                streak += 1
                curr -= timedelta(days=1)
        for i in range(6, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            last_7_days.append(d in date_set)
        last_7_days = last_7_days[-7:]

    return {
        "workouts": workouts,
        "weights": weights,
        "catalog": [{"name": c.name, "category": c.category} for c in catalog],
        "favorites": fav_names,
        "streak": {"streak": streak, "last_7_days": last_7_days}
    }

# --- Логика уведомлений ---

async def check_workout_inactivity():
    """Проверка тренировок в 20:00 по будням"""
    try:
        now = datetime.now()
        # 0=Mon, 4=Fri
        if now.weekday() > 4:
            return

        database = db.SessionLocal()
        users = database.query(db.User).all()

        for user in users:
            workout = database.query(db.Workout).filter(
                db.Workout.telegram_id == user.telegram_id,
                db.Workout.date == date_str
            ).first()
            
            if not workout:
                message = "💪 Ты сегодня еще не заполнил тренировку! Не забудь внести данные в Forma."
                await send_notification(user.telegram_id, message)
        
        database.close()
    except Exception as e:
        print(f"Ошибка в check_workout_inactivity: {e}")

async def check_weight_inactivity():
    """Проверка веса каждые 3 дня"""
    try:
        database = db.SessionLocal()
        users = database.query(db.User).all()
        three_days_ago = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")

        for user in users:
            last_entry = database.query(db.WeightEntry).filter(
                db.WeightEntry.user_id == user.telegram_id
            ).order_by(db.WeightEntry.date.desc()).first()
            
            if not last_entry or last_entry.date < three_days_ago:
                message = "⚖️ Прошло уже 3 дня, а ты не обновлял свой вес. Пора встать на весы!"
                await send_notification(user.telegram_id, message)
                
        database.close()
    except Exception as e:
        print(f"Ошибка in check_weight_inactivity: {e}")

def run_async(func):
    """Helper для запуска асинхронных задач из планировщика"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    if loop.is_running():
        asyncio.run_coroutine_threadsafe(func(), loop)
    else:
        loop.run_until_complete(func())

# Настройка планировщика
scheduler = BackgroundScheduler()

# Добавляем задачи
scheduler.add_job(
    run_async, 
    'cron', 
    day_of_week='mon-fri', 
    hour=20, 
    minute=0, 
    args=[check_workout_inactivity],
    timezone='Europe/Moscow'
)

scheduler.add_job(
    run_async, 
    'interval', 
    days=1, 
    args=[check_weight_inactivity] 
)

# (Удалено, так как перенесено выше)

# --- ADMIN PANEL ---
class UserAdmin(ModelView, model=db.User):
    column_list = [db.User.telegram_id, db.User.username, db.User.first_name]
    name = "Пользователь"
    name_plural = "Пользователи"
    icon = "fa-solid fa-user"

class WorkoutAdmin(ModelView, model=db.Workout):
    column_list = [db.Workout.id, db.Workout.telegram_id, db.Workout.date]
    name = "Тренировка"
    name_plural = "Тренировки"
    icon = "fa-solid fa-calendar-check"

class ExerciseAdmin(ModelView, model=db.Exercise):
    column_list = [db.Exercise.id, db.Exercise.name, db.Exercise.workout_id]
    name = "Упражнение"
    name_plural = "Упражнения"
    icon = "fa-solid fa-dumbbell"

class SetAdmin(ModelView, model=db.Set):
    column_list = [db.Set.id, db.Set.exercise_id, db.Set.weight, db.Set.reps]
    name = "Подход"
    name_plural = "Подходы"
    icon = "fa-solid fa-list-ol"

class WeightAdmin(ModelView, model=db.WeightEntry):
    column_list = [db.WeightEntry.id, db.WeightEntry.user_id, db.WeightEntry.weight, db.WeightEntry.date]
    name = "Запись веса"
    name_plural = "Записи веса"
    icon = "fa-solid fa-weight-scale"

class CatalogAdmin(ModelView, model=db.ExerciseCatalog):
    column_list = [db.ExerciseCatalog.id, db.ExerciseCatalog.name, db.ExerciseCatalog.category]
    category = "Справочники"
    name = "Каталог"
    name_plural = "Каталог упражнений"
    icon = "fa-solid fa-book"

class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        username, password = form.get("username"), form.get("password")
        if username == os.getenv("ADMIN_USERNAME") and password == os.getenv("ADMIN_PASSWORD"):
            request.session.update({"token": "authenticated"})
            return True
        return False

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        return request.session.get("token") == "authenticated"

authentication_backend = AdminAuth(secret_key=os.getenv("SECRET_KEY"))
admin = Admin(app, db.engine, title="MyForma Admin", authentication_backend=authentication_backend)
admin.add_view(UserAdmin)
admin.add_view(WorkoutAdmin)
admin.add_view(ExerciseAdmin)
admin.add_view(SetAdmin)
admin.add_view(WeightAdmin)
admin.add_view(CatalogAdmin)

# Раздача статики фронтенда
# ВАЖНО: это должно быть в самом низу файла, после настройки Admin
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
