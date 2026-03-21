import os
import asyncio
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
bot = Bot(token=TOKEN)
dp = Dispatcher()

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    await message.answer(
        f"Привет, {message.from_user.first_name}! 👋\n\n"
        "Я твой ИИ-тренер Forma. Я буду напоминать тебе заполнять журнал тренировок и веса.\n\n"
        "Для начала работы открой приложение кнопкой слева от ввода текста! 👇"
    )

async def send_notification(chat_id: int, text: str):
    """Отправка уведомления пользователю"""
    try:
        await bot.send_message(chat_id, text)
        return True
    except Exception as e:
        print(f"Ошибка при отправке уведомления {chat_id}: {e}")
        return False

async def send_workout_photo(chat_id: int, photo_bytes: bytes, filename: str):
    """Отправка картинки тренировки пользователю"""
    try:
        from aiogram.types import BufferedInputFile
        photo = BufferedInputFile(photo_bytes, filename=filename)
        await bot.send_photo(chat_id, photo, caption="Твоя тренировка готова! 💪📈")
        return True
    except Exception as e:
        print(f"Ошибка при отправке фото {chat_id}: {e}")
        return False

async def main():
    print("Бот запущен...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
