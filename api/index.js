import 'dotenv/config';
import { Client4 } from '@mattermost/client';
import express from 'express';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфигурация Mattermost
const mattermostUrl = process.env.MATTERMOST_URL;
const botToken = process.env.BOT_TOKEN;

if (!mattermostUrl || !botToken) {
  process.exit(1);
}

// Создание и настройка клиента
const client = new Client4();
client.setUrl(mattermostUrl);
client.setToken(botToken.replace('Bearer ', ''));

// Получение участников канала
async function getChannelMembers(channelId) {
  const members = await client.getChannelMembers(channelId);
  const userIds = Array.isArray(members) ? members.map((m) => m.user_id) : [];
  const users = [];

  for (const userId of userIds) {
    const user = await client.getUser(userId);
    if (!user.is_bot && user.delete_at === 0) {
      users.push(user);
    }
  }

  return users;
}

// Создание поста через HTTP (резервный метод)
async function createPostHttp(channelId, message) {
  const postData = {
    channel_id: channelId,
    message: message,
  };

  const response = await fetch(`${mattermostUrl}/api/v4/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken.replace('Bearer ', '')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postData),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

// Генерация случайных групп
function createGroups(users, groupSize) {
  const shuffled = [...users].sort(() => 0.5 - Math.random());
  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }
  return groups;
}

// Поиск пользователя по имени
function findUserByName(users, name) {
  const normalizedName = name.trim().toLowerCase();
  return users.find((user) => {
    const username = user.username.toLowerCase();
    const fullName = `${user.first_name} ${user.last_name}`.trim().toLowerCase();
    return username === normalizedName || fullName === normalizedName;
  });
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  const { channel_id, text } = req.body;

  if (!text || text.trim() === '') {
    res.json({
      response_type: 'ephemeral',
      text: `**GroupBot - Справка:**
      
• \`/groupbot <число> <имя1>\\n<имя2>\\n...\` - создать группы из указанных участников
  Пример: \`/groupbot 2 Елена Ященко\\nАнатолий Кириллов\\nАнастасия Гречанова\`
      
**Требования:**
→ Число участников в группе: 2–5
→ Имена должны соответствовать username или имени/фамилии участников канала`,
    });
    return;
  }

  // Парсинг команды
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    res.json({
      response_type: 'ephemeral',
      text: 'Ошибка: укажите число участников и минимум одного участника.',
    });
    return;
  }

  const groupSize = parseInt(lines[0], 10);
  if (isNaN(groupSize) || groupSize < 2 || groupSize > 5) {
    res.json({
      response_type: 'ephemeral',
      text: 'Ошибка: число участников в группе должно быть от 2 до 5.',
    });
    return;
  }

  const names = lines.slice(1);
  if (!names.length) {
    res.json({
      response_type: 'ephemeral',
      text: 'Ошибка: укажите хотя бы одного участника.',
    });
    return;
  }

  try {
    // Получение участников канала
    const channelMembers = await getChannelMembers(channel_id);
    if (!channelMembers.length) {
      res.json({
        response_type: 'ephemeral',
        text: 'Не удалось получить участников канала.',
      });
      return;
    }

    // Поиск указанных пользователей
    const selectedUsers = [];
    const notFound = [];

    for (const name of names) {
      const user = findUserByName(channelMembers, name);
      if (user) {
        selectedUsers.push(user);
      } else {
        notFound.push(name);
      }
    }

    if (notFound.length) {
      res.json({
        response_type: 'ephemeral',
        text: `Ошибка: не найдены участники: ${notFound.join(
          ', ',
        )}. Проверьте имена или username.`,
      });
      return;
    }

    if (selectedUsers.length < groupSize) {
      res.json({
        response_type: 'ephemeral',
        text: `Ошибка: недостаточно участников (${selectedUsers.length}) для групп размера ${groupSize}.`,
      });
      return;
    }

    // Формирование групп
    const groups = createGroups(selectedUsers, groupSize);
    let response = `## 🎯 Сформированные группы\n`;
    response += `**Участников:** ${selectedUsers.length} | **Размер групп:** ${groupSize}\n\n`;
    groups.forEach((group, index) => {
      const members = group.map((user) => `@${user.username}`).join(', ');
      response += `**Группа ${index + 1}:** ${members}\n`;
    });

    const remainder = selectedUsers.length % groupSize;
    if (remainder > 0) {
      response += `\n*Последняя группа содержит ${remainder} человек*`;
    }

    // Публикация результата
    try {
      await client.createPost({ channel_id, message: response });
    } catch {
      await createPostHttp(channel_id, response);
    }

    res.json({
      response_type: 'ephemeral',
      text: 'Группы успешно созданы и опубликованы в канале!',
    });
  } catch (error) {
    res.json({
      response_type: 'ephemeral',
      text: `Ошибка: ${error.message}`,
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {});

export default app;
