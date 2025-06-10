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
  console.error(
    'Ошибка: MATTERMOST_URL или BOT_TOKEN отсутствуют в переменных окружения',
  );
  process.exit(1);
}

// Создание и настройка клиента
const client = new Client4();
client.setUrl(mattermostUrl);

// Проверка аутентификации
async function testAuth() {
  try {
    const cleanToken = botToken.replace('Bearer ', '');
    client.setToken(cleanToken);
    await client.getMe();
    return true;
  } catch (error) {
    return false;
  }
}

// Получение участников канала через HTTP
async function getChannelMembersHttp(channelId) {
  try {
    const cleanToken = botToken.replace('Bearer ', '');

    const membersResponse = await fetch(
      `${mattermostUrl}/api/v4/channels/${channelId}/members`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!membersResponse.ok) {
      throw new Error(`Ошибка получения участников: ${membersResponse.status}`);
    }

    const members = await membersResponse.json();
    const userIds = members.map((member) => member.user_id);

    const users = [];
    for (const userId of userIds) {
      try {
        const userResponse = await fetch(`${mattermostUrl}/api/v4/users/${userId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (userResponse.ok) {
          const user = await userResponse.json();
          if (!user.is_bot && user.delete_at === 0) {
            users.push(user);
          }
        }
      } catch (error) {
        // Игнорируем ошибки отдельных пользователей
      }
    }

    return users;
  } catch (error) {
    return [];
  }
}

// Получение участников канала
async function getChannelMembers(channelId) {
  try {
    try {
      await client.getMe();

      const members = await client.getChannelMembers(channelId);
      const userIds = Array.isArray(members) ? members.map((m) => m.user_id) : [];

      const users = [];
      for (const userId of userIds) {
        try {
          const user = await client.getUser(userId);
          if (!user.is_bot && user.delete_at === 0) {
            users.push(user);
          }
        } catch (error) {
          // Игнорируем ошибки отдельных пользователей
        }
      }

      return users;
    } catch (sdkError) {
      return await getChannelMembersHttp(channelId);
    }
  } catch (error) {
    return [];
  }
}

// Создание поста через HTTP
async function createPostHttp(channelId, message, props = null) {
  try {
    const cleanToken = botToken.replace('Bearer ', '');
    const postData = {
      channel_id: channelId,
      message: message,
    };

    if (props) {
      postData.props = props;
    }

    const response = await fetch(`${mattermostUrl}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postData),
    });

    if (response.ok) {
      return await response.json();
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw error;
  }
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
  if (!session) return;

  const selectedCount = session.selectedUsers.length;
  const selectedUsernames = session.allUsers
    .filter((user) => session.selectedUsers.includes(user.id))
    .map((user) => `@${user.username}`)
    .join(', ');

  const baseUrl = process.env.VERCEL_URL || 'https://mattermost-bot-vert.vercel.app';

  // Создаем кнопки для каждого пользователя
  const userButtons = session.allUsers.slice(0, 20).map((user) => ({
    name: `${session.selectedUsers.includes(user.id) ? '✅' : '⬜'} ${user.username}`,
    integration: {
      url: `${baseUrl}/toggle-user`,
      context: {
        action: 'toggle_user',
        user_id: userId,
        target_user_id: user.id,
        channel_id: channelId,
      },
    },
    type: 'button',
    style: session.selectedUsers.includes(user.id) ? 'primary' : 'default',
  }));

  const attachments = [
    {
      color: '#2196F3',
      title: '🎯 Создание групп',
      text: `Найдено участников в канале: **${session.allUsers.length}**\n\n**Шаг 1:** Выберите участников (${selectedCount} выбрано)`,
      actions: userButtons.slice(0, 5), // Ограничиваем количество кнопок в строке
    },
  ];

  // Добавляем дополнительные строки кнопок если нужно
  if (userButtons.length > 5) {
    for (let i = 5; i < userButtons.length; i += 5) {
      attachments.push({
        color: '#2196F3',
        text: ' ',
        actions: userButtons.slice(i, i + 5),
      });
    }
  }

  // Показываем выбранных пользователей
  if (selectedCount > 0) {
    attachments.push({
      color: '#4CAF50',
      text: `**Выбранные участники:** ${selectedUsernames}`,
      actions: [],
    });
  }

  // Выбор размера группы
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

  // Кнопка создания групп (активна только если выбраны пользователи)
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

// Создание интерактивного меню для выбора участников
async function createSelectionMenu(channelId, userId) {
  try {
    const channelMembers = await getChannelMembers(channelId);

    if (channelMembers.length === 0) {
      throw new Error('Не удалось получить участников канала');
    }

    // Инициализируем сессию пользователя
    sessions[userId] = {
      selectedUsers: [],
      groupSize: 3,
      channelId: channelId,
      allUsers: channelMembers,
    };

    const attachments = await updateSelectionMenu(channelId, userId);

    // Отправляем меню
    try {
      await client.createPost({
        channel_id: channelId,
        message: '',
        props: {
          attachments: attachments,
        },
      });
    } catch (sdkError) {
      await createPostHttp(channelId, '', { attachments: attachments });
    }
  } catch (error) {
    throw error;
  }
}

// Инициализация клиента
async function initializeClient() {
  const isAuth = await testAuth();
  return isAuth;
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  const { channel_id, user_id, text } = req.body;

  try {
    const isAuth = await initializeClient();
    if (!isAuth) {
      res.json({
        response_type: 'ephemeral',
        text: 'Ошибка авторизации бота. Проверьте токен и права доступа.',
      });
      return;
    }

    if (!text || text.trim() === '' || text.trim() === 'menu') {
      await createSelectionMenu(channel_id, user_id);
      res.json({
        response_type: 'ephemeral',
        text: 'Интерактивное меню создано! Выберите участников кликая по кнопкам.',
      });
    } else if (text.includes('quick')) {
      const channelMembers = await getChannelMembers(channel_id);
      if (channelMembers.length === 0) {
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
        await client.createPost({
          channel_id,
          message: response,
        });
      } catch (postError) {
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
→ Выбрать конкретных участников (кликая по кнопкам)
→ Задать размер групп (2-5 человек)
→ Создать случайные группы`,
      });
    }
  } catch (error) {
    res.json({
      response_type: 'ephemeral',
      text: `Ошибка: ${error.message}`,
    });
  }
});

// Переключение выбора пользователя
app.post('/toggle-user', async (req, res) => {
  console.log('=== TOGGLE USER REQUEST ===');
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const { user_id, target_user_id, channel_id } = req.body.context || {};

  console.log('Extracted data:', { user_id, target_user_id, channel_id });
  console.log('Sessions:', Object.keys(sessions));

  if (!user_id || !sessions[user_id]) {
    console.log('Session not found or expired');
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  const session = sessions[user_id];
  const userIndex = session.selectedUsers.indexOf(target_user_id);

  console.log('Current selected users:', session.selectedUsers);
  console.log('Target user index:', userIndex);

  if (userIndex === -1) {
    // Добавляем пользователя
    session.selectedUsers.push(target_user_id);
    console.log('Added user:', target_user_id);
  } else {
    // Убираем пользователя
    session.selectedUsers.splice(userIndex, 1);
    console.log('Removed user:', target_user_id);
  }

  console.log('Updated selected users:', session.selectedUsers);

  // Обновляем меню
  const attachments = await updateSelectionMenu(channel_id, user_id);

  console.log('Sending update response');
  res.json({
    update: {
      message: '',
      props: {
        attachments: attachments,
      },
    },
  });
});

// Сброс выбора
app.post('/reset-selection', async (req, res) => {
  console.log('=== RESET SELECTION REQUEST ===');
  console.log('Body:', JSON.stringify(req.body, null, 2));

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
      props: {
        attachments: attachments,
      },
    },
  });
});

// Обработка выбора размера группы
app.post('/select-size', async (req, res) => {
  console.log('=== SELECT SIZE REQUEST ===');
  console.log('Body:', JSON.stringify(req.body, null, 2));

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
    console.log('Updated group size to:', sessions[user_id].groupSize);
  }

  const attachments = await updateSelectionMenu(channel_id, user_id);

  res.json({
    update: {
      message: '',
      props: {
        attachments: attachments,
      },
    },
  });
});

// Создание групп
app.post('/create-groups', async (req, res) => {
  console.log('=== CREATE GROUPS REQUEST ===');
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const { channel_id, user_id } = req.body.context || {};

  if (!user_id || !sessions[user_id]) {
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  const session = sessions[user_id];

  if (session.selectedUsers.length === 0) {
    res.json({
      ephemeral_text: 'Выберите участников перед созданием групп!',
    });
    return;
  }

  try {
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
      await client.createPost({
        channel_id,
        message: response,
      });
    } catch (sdkError) {
      await createPostHttp(channel_id, response);
    }

    delete sessions[user_id];

    res.json({
      ephemeral_text: '🎉 Группы успешно созданы и опубликованы в канале!',
    });
  } catch (error) {
    console.error('Error creating groups:', error);
    res.json({
      ephemeral_text: `Ошибка при создании групп: ${error.message}`,
    });
  }
});

// Добавляем общий обработчик для всех POST запросов для отладки
app.use('*', (req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  console.log('Body:', req.body);
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const authStatus = await testAuth();
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    mattermost_auth: authStatus,
    sessions_active: Object.keys(sessions).length,
  });
});

// Инициализация при старте
initializeClient().catch(() => {
  // Игнорируем ошибку при старте
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

export default app;
