from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Date, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import os

SQLALCHEMY_DATABASE_URL = "sqlite:///./forma.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    telegram_id = Column(Integer, primary_key=True, index=True)
    username = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    photo_url = Column(String, nullable=True)

class Workout(Base):
    __tablename__ = "workouts"
    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(Integer, ForeignKey("users.telegram_id"))
    date = Column(String)  # Сохраняем как YYYY-MM-DD

    exercises = relationship("Exercise", back_populates="workout", cascade="all, delete")

class Exercise(Base):
    __tablename__ = "exercises"
    id = Column(Integer, primary_key=True, index=True)
    workout_id = Column(Integer, ForeignKey("workouts.id", ondelete="CASCADE"))
    name = Column(String)

    workout = relationship("Workout", back_populates="exercises")
    sets = relationship("Set", back_populates="exercise", cascade="all, delete")

class Set(Base):
    __tablename__ = "sets"
    id = Column(Integer, primary_key=True, index=True)
    exercise_id = Column(Integer, ForeignKey("exercises.id", ondelete="CASCADE"))
    weight = Column(Float)
    reps = Column(Integer)

    exercise = relationship("Exercise", back_populates="sets")

class WeightEntry(Base):
    __tablename__ = "weight_entries"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.telegram_id"))
    weight = Column(Float)
    date = Column(String)  # YYYY-MM-DD
    timestamp = Column(String)  # Полная дата-время

    user = relationship("User", back_populates="weights")

class ExerciseCatalog(Base):
    __tablename__ = "exercise_catalog"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String, index=True)

class UserFavorite(Base):
    __tablename__ = "user_favorites"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.telegram_id"))
    exercise_name = Column(String)

User.weights = relationship("WeightEntry", back_populates="user")
User.favorites = relationship("UserFavorite", cascade="all, delete")

def init_db():
    Base.metadata.create_all(bind=engine)
