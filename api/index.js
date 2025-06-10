import 'dotenv/config';
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

// Генерация случайных групп
function createGroups(users, groupSize) {
  const shuffled = [...users].sort(() => 0.5 - Math.random());
  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }
  return groups;
}

// Создание поста в Mattermost
async function createPost(channelId, message) {
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

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  const { channel_id, text } = req.body;

  if (!text || text.trim() === '') {
    res.json({
      response_type: 'ephemeral',
      text: `**GroupBot - Справка:**
      
• \`/groupbot <число> | <имя1> |\n| --- |\n| <имя2> |\n| <имя3> |\n...\` - создать группы
  Пример:
  \`\`\`
  /groupbot 2 | Елена Ященко |
  | --- |
  | Анатолий Кириллов |
  | Анастасия Гречанова |
  \`\`\`
      
**Требования:**
→ Число участников в группе: 2–5
→ Имена на отдельных строках`,
    });
    return;
  }

  // Парсинг команды
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3 || !lines[1].match(/^\|\s*---\s*\|$/)) {
    res.json({
      response_type: 'ephemeral',
      text: 'Ошибка: неверный формат команды. Используйте пример из справки.',
    });
    return;
  }

  // Извлечение числа и первого имени
  const firstLineMatch = lines[0].match(/^\s*(\d+)\s*\|\s*([^|]+)\s*\|$/);
  if (!firstLineMatch) {
    res.json({
      response_type: 'ephemeral',
      text: 'Ошибка: первая строка должна содержать число и имя (например, "2 | Елена Ященко |").',
    });
    return;
  }

  const groupSize = parseInt(firstLineMatch[1], 10);
  const firstName = firstLineMatch[2].trim();

  if (isNaN(groupSize) || groupSize < 2 || groupSize > 5) {
    res.json({
      response_type: 'ephemeral',
      text: 'Ошибка: число участников в группе должно быть от 2 до 5.',
    });
    return;
  }

  // Извлечение остальных имен
  const names = [firstName];
  for (const line of lines.slice(2)) {
    const nameMatch = line.match(/^\s*\|\s*([^|]+)\s*\|$/);
    if (nameMatch) {
      names.push(nameMatch[1].trim());
    }
  }

  if (names.length < groupSize) {
    res.json({
      response_type: 'ephemeral',
      text: `Ошибка: недостаточно участников (${names.length}) для групп размера ${groupSize}.`,
    });
    return;
  }

  try {
    // Формирование групп
    const groups = createGroups(names, groupSize);
    let response = `## 🎯 Сформированные группы\n`;
    response += `**Участников:** ${names.length} | **Размер групп:** ${groupSize}\n\n`;
    groups.forEach((group, index) => {
      const members = group.join(', ');
      response += `**Группа ${index + 1}:** ${members}\n`;
    });

    const remainder = names.length % groupSize;
    if (remainder > 0) {
      response += `\n*Последняя группа содержит ${remainder} участников*`;
    }

    // Публикация результата
    await createPost(channel_id, response);

    res.json({
      response_type: 'ephemeral',
      text: 'Группы успешно сформированы и опубликованы!',
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
