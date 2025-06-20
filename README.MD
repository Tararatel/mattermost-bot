# Mattermost GroupBot

Mattermost GroupBot — это бот для Mattermost, который создает случайные группы из указанных участников. Бот принимает команду в формате `/groupbot <число> | <имя1> |\n| --- |\n| <имя2> |\n...`, формирует группы заданного размера и публикует результат в канале.

## Возможности

- Создание случайных групп из списка имен, указанных в команде.
- Поддержка групп размером от 2 до 5 участников.
- Простая интеграция с Mattermost через Slash-команду.
- Развертывание на Vercel как serverless-приложение.
- Сообщения на русском языке для удобства пользователей.

## Пример использования

Введите в Mattermost следующую команду:

```
/groupbot 2 | Боб Бобович |
| --- |
| Том Томович |
| Джек Джекович |
| Джефф Джеффович |
```

Бот опубликует результат:
```markdown
## 🎯 Сформированные группы
**Участников:** 4 | **Размер групп:** 2

**Группа 1:** Боб Бобович, Том Томович
**Группа 2:** Джек Джекович, Джефф Джеффович
```

И отправит эфемерное сообщение:
```
Группы успешно сформированы и опубликованы!
```

## Требования

- Node.js (версия 18 или выше)
- Аккаунт Mattermost с правами на создание ботов и Slash-команд
- Аккаунт Vercel для развертывания (опционально, для продакшена)
- Доступ к Mattermost API (токен бота)

## Установка

1. **Клонируйте репозиторий**:
   ```bash
   git clone https://github.com/your-username/mattermost-groupbot.git
   cd mattermost-groupbot
   ```

2. **Установите зависимости**:
   ```bash
   npm install
   ```

3. **Настройте переменные окружения**:
   Создайте файл `.env` в корне проекта:
   ```env
   MATTERMOST_URL=https://your-mattermost-instance.com
   BOT_TOKEN=your-bot-token
   ```

   - `MATTERMOST_URL`: URL вашего Mattermost-сервера.
   - `BOT_TOKEN`: Токен бота, созданного в Mattermost (см. ниже).

4. **Создайте бота в Mattermost**:
   - Войдите в Mattermost как администратор.
   - Перейдите в **System Console** → **Integrations** → **Bot Accounts**.
   - Создайте бота, скопируйте его токен и добавьте в `.env` как `BOT_TOKEN`.
   - Убедитесь, что бот имеет права на создание постов в целевых каналах.

5. **Настройте Slash-команду**:
   - В Mattermost: **System Console** → **Integrations** → **Slash Commands**.
   - Создайте команду:
     - **Command Trigger**: `/groupbot`
     - **Request URL**: `http://localhost:3000/groupbot` (для локального тестирования) или `https://your-vercel-app.vercel.app/groupbot` (для продакшена).
     - **Request Method**: POST
     - **Autocomplete**: Включите
     - **Hint**: `[число] | [имя1] |\n| --- |\n| [имя2] |\n...`
     - **Description**: `Создает случайные группы. Пример: /groupbot 2 | Боб Бобович |\n| --- |\n| Том Томович |`
   - Сохраните.

6. **Запустите локально**:
   ```bash
   npm start
   ```

7. **Тестирование локально с ngrok**:
   - Установите ngrok:
     ```bash
     npm install -g ngrok
     ```
   - Запустите:
     ```bash
     ngrok http 3000
     ```
   - Обновите URL Slash-команды в Mattermost на `https://your-ngrok-subdomain.ngrok.io/groupbot`.
   - Тестируйте команду в Mattermost.

## Развертывание на Vercel

1. **Создайте репозиторий на GitHub**:
   - Пушьте проект в GitHub:
     ```bash
     git init
     git add .
     git commit -m "Initial commit"
     git remote add origin https://github.com/your-username/mattermost-groupbot.git
     git push -u origin main
     ```

2. **Импортируйте в Vercel**:
   - Войдите в Vercel, выберите **Import Project** → **GitHub**.
   - Выберите ваш репозиторий и импортируйте.

3. **Настройте переменные окружения**:
   - В Vercel Dashboard → **Settings** → **Environment Variables** добавьте:
     - `MATTERMOST_URL`: URL Mattermost.
     - `BOT_TOKEN`: Токен бота.

4. **Деплой**:
   - Vercel автоматически деплоит проект.
   - Скопируйте URL деплоя (например, `https://your-vercel-app.vercel.app`).
   - Обновите Slash-команду в Mattermost, указав `https://your-vercel-app.vercel.app/groupbot`.

5. **Тестируйте**:
   - Введите команду в Mattermost и проверьте результат.

## Структура проекта

```
├── api/
│   └── index.js       # Основной код бота
├── .env               # Переменные окружения
├── package.json       # Зависимости и конфигурация
├── README.md          # Документация
```

## Зависимости

- `express`: Фреймворк для обработки HTTP-запросов.
- `dotenv`: Загрузка переменных окружения из `.env`.

Установлены через:
```bash
npm install express dotenv
```

## Формат команды

Команда должна быть в формате:
```
/groupbot <число> | <имя1> |
| --- |
| <имя2> |
| <имя3> |
...
```

- `<число>`: Размер группы (2–5).
- `<имя1>`, `<имя2>`, ...: Имена участников, каждое на новой строке.
- `| --- |`: Обязательный разделитель после первой строки.

## Ошибки

Бот возвращает эфемерные сообщения при ошибках:
- Неверный формат: «Ошибка: неверный формат команды. Используйте пример из справки.»
- Некорректное число: «Ошибка: число участников в группе должно быть от 2 до 5.»
- Недостаточно участников: «Ошибка: недостаточно участников (${names.length}) для групп размера ${groupSize}.»
- Проблемы с API: «Ошибка: ${error.message}»

## Лицензия

MIT License. См. [LICENSE](LICENSE) для деталей.

