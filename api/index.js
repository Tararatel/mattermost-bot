import 'dotenv/config';
import { Client4 } from '@mattermost/client';
import express from 'express';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфигурация Mattermost
const mattermostUrl = process.env.MATTERMOST_URL;
const botToken = process.env.BOT_TOKEN;

console.log('Загруженные переменные окружения:', {
  mattermostUrl,
  botToken: botToken ? 'установлен' : 'отсутствует',
});

if (!mattermostUrl || !botToken) {
  console.error(
    'Ошибка: MATTERMOST_URL или BOT_TOKEN отсутствуют в переменных окружения',
  );
  process.exit(1);
}

// Создание и настройка клиента
const client = new Client4();
client.setUrl(mattermostUrl);

console.log('Клиент настроен с URL:', mattermostUrl);

// Проверка аутентификации
async function testAuth() {
  console.log('Тестируем авторизацию...');

  try {
    const cleanToken = botToken.replace('Bearer ', '');
    client.setToken(cleanToken);

    const me = await client.getMe();
    console.log('Авторизация успешна! Пользователь:', {
      id: me.id,
      username: me.username,
      is_bot: me.is_bot,
    });
    return true;
  } catch (error) {
    console.error('Ошибка авторизации:', error.message);
    return false;
  }
}

// Получение участников канала через HTTP
async function getChannelMembersHttp(channelId) {
  try {
    const cleanToken = botToken.replace('Bearer ', '');

    // Получаем список участников канала
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

    // Получаем информацию о пользователях
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
          // Фильтруем ботов и удаленных пользователей
          if (!user.is_bot && user.delete_at === 0) {
            users.push(user);
          }
        }
      } catch (error) {
        console.error(`Ошибка получения пользователя ${userId}:`, error.message);
      }
    }

    console.log(`Получено участников канала: ${users.length}`);
    return users;
  } catch (error) {
    console.error('Ошибка получения участников канала:', error.message);
    return [];
  }
}

// Получение участников канала через SDK
async function getChannelMembers(channelId) {
  try {
    console.log('Получаем участников канала:', channelId);

    // Сначала пробуем через SDK
    try {
      await client.getMe(); // Проверяем аутентификацию

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
          console.error(`Ошибка получения пользователя ${userId}:`, error.message);
        }
      }

      console.log(`SDK: Получено участников канала: ${users.length}`);
      return users;
    } catch (sdkError) {
      console.log('SDK не работает, используем HTTP...');
      return await getChannelMembersHttp(channelId);
    }
  } catch (error) {
    console.error('Ошибка получения участников канала:', error.message);
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
      const post = await response.json();
      console.log('Пост создан успешно через HTTP:', post.id);
      return post;
    } else {
      const errorText = await response.text();
      console.error('Ошибка создания поста через HTTP:', response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
  } catch (error) {
    console.error('Ошибка HTTP запроса создания поста:', error.message);
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

// Создание интерактивного меню для выбора участников
async function createSelectionMenu(channelId, userId) {
  try {
    const channelMembers = await getChannelMembers(channelId);

    if (channelMembers.length === 0) {
      throw new Error('Не удалось получить участников канала');
    }

    // Инициализируем сессию пользователя
    if (!sessions[userId]) {
      sessions[userId] = {
        selectedUsers: [],
        groupSize: 3,
        channelId: channelId,
        allUsers: channelMembers,
      };
    } else {
      sessions[userId].channelId = channelId;
      sessions[userId].allUsers = channelMembers;
      sessions[userId].selectedUsers = [];
    }

    // Формируем опции для выбора пользователей (ограничиваем до 25 из-за лимитов Mattermost)
    const userOptions = channelMembers.slice(0, 25).map((user) => ({
      text: `${user.first_name} ${user.last_name} (@${user.username})`.trim(),
      value: user.id,
    }));

    const baseUrl = process.env.VERCEL_URL || 'https://mattermost-bot-vert.vercel.app';

    const attachments = [
      {
        color: '#2196F3',
        title: '🎯 Создание групп',
        text: `Найдено участников в канале: **${channelMembers.length}**\n\n**Шаг 1:** Выберите участников для формирования групп`,
        actions: [
          {
            name: 'select_users',
            type: 'select',
            data_source: 'static',
            placeholder: 'Выберите участников...',
            options: userOptions,
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
      {
        color: '#4CAF50',
        text: '**Шаг 2:** Выберите размер групп',
        actions: [
          {
            name: 'select_size',
            type: 'select',
            placeholder: 'Размер группы: 3',
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
      },
      {
        color: '#FF9800',
        text: '**Шаг 3:** Создайте группы',
        actions: [
          {
            name: 'create_groups',
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
        ],
      },
    ];

    // Пытаемся отправить через SDK, если не получается - через HTTP
    try {
      await client.createPost({
        channel_id: channelId,
        message: '',
        props: {
          attachments: attachments,
        },
      });
      console.log('Интерактивное меню отправлено через SDK');
    } catch (sdkError) {
      console.log('SDK не работает, отправляем через HTTP...');
      await createPostHttp(channelId, '', { attachments: attachments });
      console.log('Интерактивное меню отправлено через HTTP');
    }
  } catch (error) {
    console.error('Ошибка создания меню:', error.message);
    throw error;
  }
}

// Инициализация клиента
async function initializeClient() {
  console.log('Инициализация Mattermost клиента...');
  const isAuth = await testAuth();
  if (!isAuth) {
    console.error('Не удалось авторизоваться в Mattermost');
    return false;
  }
  return true;
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  console.log('Получена команда /groupbot:', req.body);
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

    // Если команда без параметров или с параметром "menu" - показываем интерактивное меню
    if (!text || text.trim() === '' || text.trim() === 'menu') {
      await createSelectionMenu(channel_id, user_id);
      res.json({
        response_type: 'ephemeral',
        text: 'Интерактивное меню создано! Выберите участников и размер групп.',
      });
    }
    // Быстрое создание групп со всеми участниками канала
    else if (text.includes('quick')) {
      const channelMembers = await getChannelMembers(channel_id);
      if (channelMembers.length === 0) {
        res.json({
          response_type: 'ephemeral',
          text: 'Не удалось получить участников канала.',
        });
        return;
      }

      const groupSize = 3; // По умолчанию
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
      // Показываем справку
      res.json({
        response_type: 'ephemeral',
        text: `**GroupBot - Справка:**
        
• \`/groupbot\` или \`/groupbot menu\` - показать интерактивное меню
• \`/groupbot quick\` - быстро создать группы из всех участников канала
        
**Интерактивное меню позволяет:**
→ Выбрать конкретных участников
→ Задать размер групп (2-5 человек)
→ Создать случайные группы`,
      });
    }
  } catch (error) {
    console.error('Ошибка при выполнении команды:', error);
    res.json({
      response_type: 'ephemeral',
      text: `Ошибка: ${error.message}`,
    });
  }
});

// Обработка выбора пользователей
app.post('/select-users', async (req, res) => {
  console.log('Выбор пользователей:', req.body);
  const { user_id, channel_id } = req.body.context || {};
  const { selected_option } = req.body;

  if (!user_id || !sessions[user_id]) {
    res.json({
      ephemeral_text: 'Сессия истекла. Запустите команду заново.',
    });
    return;
  }

  if (selected_option && selected_option.value) {
    const userId = selected_option.value;
    if (!sessions[user_id].selectedUsers.includes(userId)) {
      sessions[user_id].selectedUsers.push(userId);
    }
  }

  const selectedCount = sessions[user_id].selectedUsers.length;
  const selectedUsernames = sessions[user_id].allUsers
    .filter((user) => sessions[user_id].selectedUsers.includes(user.id))
    .map((user) => user.username)
    .join(', ');

  res.json({
    update: {
      message: `✅ **Выбрано участников: ${selectedCount}**\n${
        selectedUsernames ? `Участники: ${selectedUsernames}` : ''
      }`,
    },
  });
});

// Обработка выбора размера группы
app.post('/select-size', async (req, res) => {
  console.log('Выбор размера группы:', req.body);
  const { user_id } = req.body.context || {};
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

  res.json({
    update: {
      message: `📊 **Размер групп: ${sessions[user_id].groupSize} человек**`,
    },
  });
});

// Создание групп
app.post('/create-groups', async (req, res) => {
  console.log('Создание групп:', req.body);
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
    // Получаем информацию о выбранных пользователях
    const selectedUserData = session.allUsers.filter((user) =>
      session.selectedUsers.includes(user.id),
    );

    if (selectedUserData.length === 0) {
      res.json({
        ephemeral_text: 'Не удалось найти выбранных пользователей!',
      });
      return;
    }

    const groups = createGroups(selectedUserData, session.groupSize);

    let response = `## 🎯 Сформированные группы\n`;
    response += `**Участников:** ${selectedUserData.length} | **Размер групп:** ${session.groupSize}\n\n`;

    groups.forEach((group, index) => {
      const members = group.map((user) => `@${user.username}`).join(', ');
      response += `**Группа ${index + 1}:** ${members}\n`;
    });

    // Добавляем информацию о неполной группе, если есть
    const remainder = selectedUserData.length % session.groupSize;
    if (remainder > 0) {
      response += `\n*Последняя группа содержит ${remainder} человек*`;
    }

    // Отправляем результат в канал
    try {
      await client.createPost({
        channel_id,
        message: response,
      });
    } catch (sdkError) {
      await createPostHttp(channel_id, response);
    }

    // Очищаем сессию
    delete sessions[user_id];

    res.json({
      ephemeral_text: '🎉 Группы успешно созданы и опубликованы в канале!',
    });
  } catch (error) {
    console.error('Ошибка при создании групп:', error);
    res.json({
      ephemeral_text: `Ошибка при создании групп: ${error.message}`,
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const authStatus = await testAuth();
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    mattermost_auth: authStatus,
    mattermost_url: mattermostUrl,
    token_present: !!botToken,
  });
});

// Диагностический endpoint
app.get('/debug', async (req, res) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      mattermost_url: mattermostUrl,
      token_present: !!botToken,
      active_sessions: Object.keys(sessions).length,
      session_details: Object.entries(sessions).map(([userId, session]) => ({
        user_id: userId,
        selected_users_count: session.selectedUsers?.length || 0,
        group_size: session.groupSize,
        channel_id: session.channelId,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Инициализация при старте
initializeClient().catch((error) => {
  console.error('Ошибка инициализации:', error.message);
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

export default app;
