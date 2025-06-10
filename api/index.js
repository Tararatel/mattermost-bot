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
async function createPostHttp(channelId, message, props = null) {
  const postData = {
    channel_id: channelId,
    message: message,
    props,
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

// Хранение сессий пользователей
const sessions = {};

// Обновление меню с текущим состоянием
async function updateSelectionMenu(channelId, userId) {
  const session = sessions[userId];
  if (!session) return null;

  const selectedCount = session.selectedUsers.length;
  const selectedUsernames = session.allUsers
    .filter((user) => session.selectedUsers.includes(user.id))
    .map((user) => `@${user.username}`)
    .join(', ');

  const baseUrl = process.env.VERCEL_URL || 'http://localhost:3000';

  const attachments = [
    {
      color: '#2196F3',
      title: '🎯 Создание групп',
      text: `Найдено участников в канале: **${session.allUsers.length}**\n\n**Шаг 1:** Выберите участников (${selectedCount} выбрано)`,
      actions: [
        {
          name: 'select_users',
          type: 'select',
          placeholder: 'Выберите участников',
          multi_select: true,
          options: session.allUsers.slice(0, 20).map((user) => ({
            text: user.username,
            value: user.id,
          })),
          integration: {
            url: `${baseUrl}/select-users`,
            context: {
              action: 'select_users',
              user_id: userId,
              channel_id: channelId,
            },
          },
        },
      ],
    },
  ];

  if (selectedCount > 0) {
    attachments.push({
      color: '#4CAF50',
      text: `**Выбранные участники:** ${selectedUsernames}`,
      actions: [],
    });
  }

  attachments.push({
    color: '#FF9800',
    text: '**Шаг 2:** Выберите размер групп',
    actions: [
      {
        name: 'select_size',
        type: 'select',
        placeholder: `Размер группы: ${session.groupSize}`,
        options: [
          { text: '👥 2 человека', value: '2' },
          { text: '👥 3 человека', value: '3' },
          { text: '👥 4 человека', value: '4' },
          { text: '👥 5 человек', value: '5' },
        ],
        integration: {
          url: `${baseUrl}/select-size`,
          context: {
            action: 'select_size',
            user_id: userId,
            channel_id: channelId,
          },
        },
      },
    ],
  });

  if (selectedCount > 0) {
    attachments.push({
      color: '#4CAF50',
      text: '**Шаг 3:** Создайте группы',
      actions: [
        {
          name: '🎲 Создать группы',
          type: 'button',
          style: 'primary',
          integration: {
            url: `${baseUrl}/create-groups`,
            context: {
              action: 'create_groups',
              user_id: userId,
              channel_id: channelId,
            },
          },
        },
        {
          name: '🔄 Сбросить выбор',
          type: 'button',
          style: 'danger',
          integration: {
            url: `${baseUrl}/reset-selection`,
            context: {
              action: 'reset_selection',
              user_id: userId,
              channel_id: channelId,
            },
          },
        },
      ],
    });
  }

  return attachments;
}

// Создание интерактивного меню
async function createSelectionMenu(channelId, userId) {
  const channelMembers = await getChannelMembers(channelId);
  if (!channelMembers.length) {
    throw new Error('Не удалось получить участников канала');
  }

  sessions[userId] = {
    selectedUsers: [],
    groupSize: 3,
    channelId: channelId,
    allUsers: channelMembers,
  };

  const attachments = await updateSelectionMenu(channelId, userId);
  try {
    await client.createPost({
      channel_id: channelId,
      message: '',
      props: { attachments },
    });
  } catch {
    await createPostHttp(channelId, '', { attachments });
  }
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  const { channel_id, user_id, text } = req.body;

  if (!text || text.trim() === '' || text.trim() === 'menu') {
    await createSelectionMenu(channel_id, user_id);
    res.json({
      response_type: 'ephemeral',
      text: 'Интерактивное меню создано! Выберите участников.',
    });
  } else if (text.includes('quick')) {
    const channelMembers = await getChannelMembers(channel_id);
    if (!channelMembers.length) {
      res.json({
        response_type: 'ephemeral',
        text: 'Не удалось получить участников канала.',
      });
      return;
    }

    const groupSize = 3;
    const groups = createGroups(channelMembers, groupSize);
    let response = `## 🎲 Случайные группы (размер: ${groupSize})\n\n`;
    groups.forEach((group, index) => {
      const members = group.map((user) => `@${user.username}`).join(', ');
      response += `**Группа ${index + 1}:** ${members}\n`;
    });

    try {
      await client.createPost({ channel_id, message: response });
    } catch {
      await createPostHttp(channel_id, response);
    }

    res.json({
      response_type: 'ephemeral',
      text: 'Группы успешно созданы!',
    });
  } else {
    res.json({
      response_type: 'ephemeral',
      text: `**GroupBot - Справка:**
      
• \`/groupbot\` или \`/groupbot menu\` - показать интерактивное меню
• \`/groupbot quick\` - быстро создать группы из всех участников канала
      
**Интерактивное меню позволяет:**
→ Выбрать участников из списка
→ Задать размер групп (2-5 человек)
→ Создать случайные группы`,
    });
  }
});

// Обработка множественного выбора пользователей
app.post('/select-users', async (req, res) => {
  console.log('=== SELECT USERS REQUEST ===');
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const { user_id, channel_id } = req.body.context || {};
  let selectedOptions = req.body.selected_options || [];

  if (!user_id || !sessions[user_id]) {
    console.log('Сессия не найдена или истекла для userId:', user_id);
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  // Обработка selected_options: проверяем, массив или объект
  if (!Array.isArray(selectedOptions)) {
    selectedOptions = selectedOptions ? [selectedOptions] : [];
  }

  console.log('Selected options:', selectedOptions);

  sessions[user_id].selectedUsers = selectedOptions.map((option) => option.value);

  console.log('Updated selectedUsers:', sessions[user_id].selectedUsers);

  const attachments = await updateSelectionMenu(channel_id, user_id);
  console.log('Response attachments:', JSON.stringify(attachments, null, 2));

  res.json({
    update: {
      message: '',
      props: { attachments },
    },
  });
});

// Сброс выбора
app.post('/reset-selection', async (req, res) => {
  const { user_id, channel_id } = req.body.context || {};

  if (!user_id || !sessions[user_id]) {
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  sessions[user_id].selectedUsers = [];
  const attachments = await updateSelectionMenu(channel_id, user_id);
  res.json({
    update: {
      message: '',
      props: { attachments },
    },
  });
});

// Обработка выбора размера группы
app.post('/select-size', async (req, res) => {
  const { user_id, channel_id } = req.body.context || {};
  const { selected_option } = req.body;

  if (!user_id || !sessions[user_id]) {
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  if (selected_option && selected_option.value) {
    sessions[user_id].groupSize = parseInt(selected_option.value, 10) || 3;
  }

  const attachments = await updateSelectionMenu(channel_id, user_id);
  res.json({
    update: {
      message: '',
      props: { attachments },
    },
  });
});

// Создание групп
app.post('/create-groups', async (req, res) => {
  const { channel_id, user_id } = req.body.context || {};

  if (!user_id || !sessions[user_id]) {
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  const session = sessions[user_id];
  if (!session.selectedUsers.length) {
    res.json({
      ephemeral_text: 'Выберите участников перед созданием групп!',
    });
    return;
  }

  const selectedUserData = session.allUsers.filter((user) =>
    session.selectedUsers.includes(user.id),
  );
  const groups = createGroups(selectedUserData, session.groupSize);

  let response = `## 🎯 Сформированные группы\n`;
  response += `**Участников:** ${selectedUserData.length} | **Размер групп:** ${session.groupSize}\n\n`;
  groups.forEach((group, index) => {
    const members = group.map((user) => `@${user.username}`).join(', ');
    response += `**Группа ${index + 1}:** ${members}\n`;
  });

  const remainder = selectedUserData.length % session.groupSize;
  if (remainder > 0) {
    response += `\n*Последняя группа содержит ${remainder} человек*`;
  }

  try {
    await client.createPost({ channel_id, message: response });
  } catch {
    await createPostHttp(channel_id, response);
  }

  delete sessions[user_id];
  res.json({
    ephemeral_text: '🎉 Группы успешно созданы и опубликованы в канале!',
  });
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
