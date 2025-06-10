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
    console.log(
      'Тестирование аутентификации для токена:',
      cleanToken.substring(0, 10) + '...',
    );
    const user = await client.getMe();
    console.log('Аутентификация успешна, пользователь:', user.id);
    return true;
  } catch (error) {
    console.error('Ошибка аутентификации:', error.message);
    return false;
  }
}

// Получение участников канала через HTTP
async function getChannelMembersHttp(channelId) {
  try {
    const cleanToken = botToken.replace('Bearer ', '');
    console.log('Получение участников канала через HTTP, channelId:', channelId);

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
    console.log('Получены участники канала:', members.length);
    const userIds = members.map((member) => member.user_id);
    console.log('ID пользователей:', userIds);

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
            console.log('Добавлен пользователь:', user.id, user.username);
            users.push(user);
          }
        }
      } catch (error) {
        console.error('Ошибка получения данных пользователя:', userId, error.message);
      }
    }

    console.log(
      'Отфильтрованные пользователи:',
      users.map((u) => ({ id: u.id, username: u.username })),
    );
    return users;
  } catch (error) {
    console.error('Ошибка в getChannelMembersHttp:', error.message);
    return [];
  }
}

// Получение участников канала
async function getChannelMembers(channelId) {
  try {
    console.log('Получение участников канала, channelId:', channelId);
    try {
      await client.getMe();
      console.log('Аутентификация SDK успешна');

      const members = await client.getChannelMembers(channelId);
      console.log('Получены участники через SDK:', members.length);
      const userIds = Array.isArray(members) ? members.map((m) => m.user_id) : [];
      console.log('ID пользователей:', userIds);

      const users = [];
      for (const userId of userIds) {
        try {
          const user = await client.getUser(userId);
          if (!user.is_bot && user.delete_at === 0) {
            console.log('Добавлен пользователь:', user.id, user.username);
            users.push(user);
          }
        } catch (error) {
          console.error('Ошибка получения данных пользователя:', userId, error.message);
        }
      }

      console.log(
        'Отфильтрованные пользователи:',
        users.map((u) => ({ id: u.id, username: u.username })),
      );
      return users;
    } catch (sdkError) {
      console.error('Ошибка SDK, переход к HTTP:', sdkError.message);
      return await getChannelMembersHttp(channelId);
    }
  } catch (error) {
    console.error('Ошибка в getChannelMembers:', error.message);
    return [];
  }
}

// Создание поста через HTTP
async function createPostHttp(channelId, message, props = null) {
  try {
    const cleanToken = botToken.replace('Bearer ', '');
    console.log('Создание поста через HTTP, channelId:', channelId);
    const postData = {
      channel_id: channelId,
      message: message,
    };

    if (props) {
      postData.props = props;
    }

    console.log('Данные поста:', JSON.stringify(postData, null, 2));

    const response = await fetch(`${mattermostUrl}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postData),
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Пост успешно создан:', result.id);
      return result;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('Ошибка в createPostHttp:', error.message);
    throw error;
  }
}

// Генерация случайных групп
function createGroups(users, groupSize) {
  console.log('Создание групп, размер:', groupSize, 'пользователи:', users.length);
  const shuffled = [...users].sort(() => 0.5 - Math.random());
  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }
  console.log(
    'Сформированные группы:',
    groups.map((g) => g.map((u) => u.username)),
  );
  return groups;
}

// Хранение сессий пользователей
const sessions = {};

// Обновление меню с текущим состоянием
async function updateSelectionMenu(channelId, userId) {
  console.log('Обновление меню, channelId:', channelId, 'userId:', userId);
  const session = sessions[userId];
  if (!session) {
    console.log('Сессия не найдена для userId:', userId);
    return;
  }

  console.log('Текущее состояние сессии:', JSON.stringify(session, null, 2));
  const selectedCount = session.selectedUsers.length;
  const selectedUsernames = session.allUsers
    .filter((user) => session.selectedUsers.includes(user.id))
    .map((user) => `@${user.username}`)
    .join(', ');
  console.log('Выбранные пользователи:', selectedUsernames);

  const baseUrl = process.env.VERCEL_URL || 'https://mattermost-bot-vert.vercel.app';
  console.log('Используемый baseUrl:', baseUrl);

  // Создаем кнопки для каждого пользователя
  const userButtons = session.allUsers.slice(0, 20).map((user) => {
    const isSelected = session.selectedUsers.includes(user.id);
    console.log(`Кнопка для пользователя ${user.username}, выбран: ${isSelected}`);
    return {
      name: `${isSelected ? '✅' : '⬜'} ${user.username}`,
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
      style: isSelected ? 'primary' : 'default',
    };
  });

  const attachments = [
    {
      color: '#2196F3',
      title: '🎯 Создание групп',
      text: `Найдено участников в канале: **${session.allUsers.length}**\n\n**Шаг 1:** Выберите участников (${selectedCount} выбрано)`,
      actions: userButtons.slice(0, 5),
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

  console.log('Сформированные attachments:', JSON.stringify(attachments, null, 2));
  return attachments;
}

// Создание интерактивного меню для выбора участников
async function createSelectionMenu(channelId, userId) {
  try {
    console.log('Создание меню для channelId:', channelId, 'userId:', userId);
    const channelMembers = await getChannelMembers(channelId);

    if (channelMembers.length === 0) {
      console.error('Не удалось получить участников канала');
      throw new Error('Не удалось получить участников канала');
    }

    console.log('Инициализация сессии для userId:', userId);
    sessions[userId] = {
      selectedUsers: [],
      groupSize: 3,
      channelId: channelId,
      allUsers: channelMembers,
    };
    console.log('Сессия создана:', JSON.stringify(sessions[userId], null, 2));

    const attachments = await updateSelectionMenu(channelId, userId);

    // Отправляем меню
    try {
      console.log('Отправка меню через SDK');
      await client.createPost({
        channel_id: channelId,
        message: '',
        props: {
          attachments: attachments,
        },
      });
      console.log('Меню успешно отправлено через SDK');
    } catch (sdkError) {
      console.error('Ошибка SDK при отправке меню, переход к HTTP:', sdkError.message);
      await createPostHttp(channelId, '', { attachments: attachments });
      console.log('Меню отправлено через HTTP');
    }
  } catch (error) {
    console.error('Ошибка в createSelectionMenu:', error.message);
    throw error;
  }
}

// Инициализация клиента
async function initializeClient() {
  console.log('Инициализация клиента Mattermost');
  const isAuth = await testAuth();
  console.log('Результат инициализации:', isAuth);
  return isAuth;
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  console.log('=== GROUPBOT REQUEST ===');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  const { channel_id, user_id, text } = req.body;

  try {
    const isAuth = await initializeClient();
    if (!isAuth) {
      console.error('Ошибка авторизации бота');
      res.json({
        response_type: 'ephemeral',
        text: 'Ошибка авторизации бота. Проверьте токен и права доступа.',
      });
      return;
    }

    if (!text || text.trim() === '' || text.trim() === 'menu') {
      console.log('Создание интерактивного меню');
      await createSelectionMenu(channel_id, user_id);
      res.json({
        response_type: 'ephemeral',
        text: 'Интерактивное меню создан! Выберите участников кликая по кнопкам.',
      });
    } else if (text.includes('quick')) {
      console.log('Быстрое создание групп');
      const channelMembers = await getChannelMembers(channel_id);
      if (channelMembers.length === 0) {
        console.error('Не удалось получить участников канала');
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
        console.log('Отправка групп через SDK');
        await client.createPost({
          channel_id,
          message: response,
        });
        console.log('Группы отправлены через SDK');
      } catch (postError) {
        console.error(
          'Ошибка SDK при отправке групп, переход к HTTP:',
          postError.message,
        );
        await createPostHttp(channel_id, response);
        console.log('Группы отправлены через HTTP');
      }

      res.json({
        response_type: 'ephemeral',
        text: 'Группы успешно созданы!',
      });
    } else {
      console.log('Отправка справки');
      res.json({
        response_type: 'ephemeral',
        text: `**GroupBot - Справка:**
        
• \`/groupbot\` или \`/群bot menu\` - показать интерактивное меню
• \`/groupbot quick\` - быстро создать группы из всех участников канала
        
**Интерактивное меню позволяет:**
→ Выбрать конкретных участников (кликая по кнопкам)
→ Задать размер групп (2-5 человек)
→ Создать случайные группы`,
      });
    }
  } catch (error) {
    console.error('Ошибка в /groupbot:', error.message);
    res.json({
      response_type: 'ephemeral',
      text: `Ошибка: ${error.message}`,
    });
  }
});

// Переключение выбора пользователя
app.post('/toggle-user', async (req, res) => {
  console.log('=== TOGGLE USER REQUEST ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('Context:', JSON.stringify(req.body.context, null, 2));

  const { user_id, target_user_id, channel_id } = req.body.context || {};

  console.log('Extracted data:', { user_id, target_user_id, channel_id });
  console.log('Sessions:', JSON.stringify(Object.keys(sessions), null, 2));

  if (!user_id || !sessions[user_id]) {
    console.log('Сессия не найдена или истекла для userId:', user_id);
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  const session = sessions[user_id];
  console.log('Текущее состояние сессии:', JSON.stringify(session, null, 2));
  const userIndex = session.selectedUsers.indexOf(target_user_id);

  console.log('Индекс целевого пользователя:', userIndex);

  if (userIndex === -1) {
    session.selectedUsers.push(target_user_id);
    console.log('Добавлен пользователь:', target_user_id);
  } else {
    session.selectedUsers.splice(userIndex, 1);
    console.log('Удален пользователь:', target_user_id);
  }

  console.log('Обновленный список выбранных пользователей:', session.selectedUsers);

  const attachments = await updateSelectionMenu(channel_id, user_id);
  console.log('Ответ с attachments:', JSON.stringify(attachments, null, 2));

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
    console.log('Сессия не найдена или истекла для userId:', user_id);
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  console.log('Сброс выбранных пользователей для userId:', user_id);
  sessions[user_id].selectedUsers = [];

  const attachments = await updateSelectionMenu(channel_id, user_id);
  console.log('Ответ с attachments:', JSON.stringify(attachments, null, 2));

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
    console.log('Сессия не найдена или истекла для userId:', user_id);
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  if (selected_option && selected_option.value) {
    sessions[user_id].groupSize = parseInt(selected_option.value, 10) || 3;
    console.log('Обновлен размер группы:', sessions[user_id].groupSize);
  }

  const attachments = await updateSelectionMenu(channel_id, user_id);
  console.log('Ответ с attachments:', JSON.stringify(attachments, null, 2));

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
    console.log('Сессия не найдена или истекла для userId:', user_id);
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  const session = sessions[user_id];

  if (session.selectedUsers.length === 0) {
    console.log('Не выбраны пользователи для создания групп');
    res.json({
      ephemeral_text: 'Выберите участников перед созданием групп!',
    });
    return;
  }

  try {
    const selectedUserData = session.allUsers.filter((user) =>
      session.selectedUsers.includes(user.id),
    );
    console.log(
      'Выбранные пользователи для групп:',
      selectedUserData.map((u) => u.username),
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
      console.log('Отправка групп через SDK');
      await client.createPost({
        channel_id,
        message: response,
      });
      console.log('Группы отправлены через SDK');
    } catch (sdkError) {
      console.error('Ошибка SDK при отправке групп, переход к HTTP:', sdkError.message);
      await createPostHttp(channel_id, response);
      console.log('Группы отправлены через HTTP');
    }

    console.log('Удаление сессии для userId:', user_id);
    delete sessions[user_id];

    res.json({
      ephemeral_text: '🎉 Группы успешно созданы и опубликованы в канале!',
    });
  } catch (error) {
    console.error('Ошибка при создании групп:', error.message);
    res.json({
      ephemeral_text: `Ошибка при создании групп: ${error.message}`,
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  console.log('=== HEALTH CHECK REQUEST ===');
  const authStatus = await testAuth();
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    mattermost_auth: authStatus,
  });
});

// Инициализация при старте
initializeClient().catch((error) => {
  console.error('Ошибка при инициализации клиента:', error.message);
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

export default app;
