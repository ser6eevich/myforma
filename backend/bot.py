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
        "Жми кнопку ниже, чтобы открыть приложение! 👇",
        reply_markup=types.InlineKeyboardMarkup(
            inline_keyboard=[
                [types.InlineKeyboardButton(text="Открыть Forma", web_app=types.WebAppInfo(url="https://your-mini-app-url.com"))]
            ]
        )
    )

async def send_notification(chat_id: int, text: str):
    """Отправка уведомления пользователю"""
    try:
        await bot.send_message(chat_id, text)
        return True
    except Exception as e:
        print(f"Ошибка при отправке уведомления {chat_id}: {e}")
        return False

async def main():
    print("Бот запущен...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
