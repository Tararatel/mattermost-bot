import 'dotenv/config';
import { Client4 } from '@mattermost/client';
import express from 'express';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфигурация Mattermost
const mattermostUrl =
  process.env.MATTERMOST_URL;
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
console.log(
  'Токен (первые/последние 5 символов):',
  botToken.substring(0, 5) + '...' + botToken.substring(botToken.length - 5),
);

// Исправленная проверка аутентификации
async function testAuth() {
  console.log('Тестируем авторизацию...');

  try {
    // Убираем Bearer если есть для установки токена
    const cleanToken = botToken.replace('Bearer ', '');
    client.setToken(cleanToken);

    console.log('Токен установлен, проверяем аутентификацию...');

    const me = await client.getMe();
    console.log('Авторизация успешна! Пользователь:', {
      id: me.id,
      username: me.username,
      roles: me.roles,
      is_bot: me.is_bot,
    });
    return true;
  } catch (error) {
    console.error('SDK авторизация неудачна:', {
      message: error.message,
      status: error.status_code,
      url: error.url,
    });

    // Пробуем прямой HTTP запрос
    console.log('Пробуем прямой HTTP запрос...');
    try {
      const cleanToken = botToken.replace('Bearer ', '');
      const response = await fetch(`${mattermostUrl}/api/v4/users/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('HTTP запрос статус:', response.status);

      if (response.ok) {
        const userData = await response.json();
        console.log('Прямой HTTP запрос успешен:', userData.username);

        // Если HTTP работает, переустанавливаем токен в клиенте
        client.setToken(cleanToken);
        return true;
      } else {
        const errorText = await response.text();
        console.error('HTTP запрос неудачен:', errorText);
      }
    } catch (httpError) {
      console.error('Ошибка HTTP запроса:', httpError.message);
    }
  }

  return false;
}

// Альтернативная функция получения пользователей через прямой HTTP запрос
async function getUsersDirectHttp() {
  try {
    console.log('Получение пользователей через прямой HTTP запрос...');
    const cleanToken = botToken.replace('Bearer ', '');

    const response = await fetch(
      `${mattermostUrl}/api/v4/users?page=0&per_page=60&in_team=${
        process.env.TEAM_ID || 'jgx6zzdutpdcpfmbayrmeydyzw'
      }`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.ok) {
      const users = await response.json();
      console.log(`Получено пользователей через HTTP: ${users.length}`);
      const filteredUsers = users.filter((user) => !user.is_bot && user.delete_at === 0);
      console.log(`Отфильтровано пользователей: ${filteredUsers.length}`);
      return filteredUsers;
    } else {
      const errorText = await response.text();
      console.error('Ошибка HTTP запроса пользователей:', response.status, errorText);
      return [];
    }
  } catch (error) {
    console.error('Ошибка прямого HTTP запроса:', error.message);
    return [];
  }
}

// Получение списка пользователей с улучшенной обработкой ошибок
async function getUsers() {
  try {
    console.log('Запрашиваем список пользователей...');

    // Сначала пробуем через SDK
    try {
      // Проверяем аутентификацию перед запросом
      await client.getMe();
      console.log('Проверка аутентификации через SDK прошла успешно');

      const users = [];
      let page = 0;
      const perPage = 60;
      let hasMore = true;

      while (hasMore && page < 3) {
        try {
          console.log(`Запрашиваем страницу ${page} через SDK...`);
          const pageUsers = await client.getProfiles(page, perPage);

          if (Array.isArray(pageUsers)) {
            users.push(...pageUsers);
            hasMore = pageUsers.length === perPage;
          } else if (pageUsers && typeof pageUsers === 'object') {
            const userArray = Object.values(pageUsers);
            users.push(...userArray);
            hasMore = userArray.length === perPage;
          } else {
            break;
          }

          page++;
        } catch (pageError) {
          console.error(`Ошибка получения страницы ${page}:`, pageError.message);
          break;
        }
      }

      if (users.length > 0) {
        const filteredUsers = users.filter(
          (user) => !user.is_bot && user.delete_at === 0,
        );
        console.log(`SDK: Всего ${users.length}, отфильтровано ${filteredUsers.length}`);
        return filteredUsers;
      }
    } catch (sdkError) {
      console.log('SDK не работает, пробуем прямой HTTP запрос...');
    }

    // Если SDK не работает, пробуем прямой HTTP запрос
    return await getUsersDirectHttp();
  } catch (error) {
    console.error('Ошибка получения пользователей:', error.message);
    return [];
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

// Исправленная функция создания поста через HTTP
async function createPostHttp(channelId, message) {
  try {
    const cleanToken = botToken.replace('Bearer ', '');
    const response = await fetch(`${mattermostUrl}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: channelId,
        message: message,
      }),
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

// Формирование интерактивного сообщения
async function createInteractiveMessage(channelId) {
  console.log('Формируем интерактивное сообщение для канала:', channelId);

  try {
    const users = await getUsers();
    if (users.length === 0) {
      console.error('Список пользователей пуст');
      throw new Error('Не удалось получить список пользователей');
    }

    const userOptions = users.slice(0, 50).map((user) => ({
      text: user.username,
      value: user.id,
    }));

    const message = {
      channel_id: channelId,
      message: 'Создать группы пользователей',
      props: {
        attachments: [
          {
            text: 'Выберите пользователей и размер группы',
            actions: [
              {
                name: 'Выбрать пользователей',
                integration: {
                  url: `${
                    process.env.VERCEL_URL || 'https://mattermost-bot-vert.vercel.app'
                  }/select-users`,
                  context: {
                    action: 'select_users',
                  },
                },
                type: 'select',
                options: userOptions,
              },
              {
                name: 'Размер группы',
                integration: {
                  url: `${
                    process.env.VERCEL_URL || 'https://mattermost-bot-vert.vercel.app'
                  }/select-size`,
                  context: {
                    action: 'select_size',
                  },
                },
                type: 'select',
                options: [
                  { text: '2', value: '2' },
                  { text: '3', value: '3' },
                  { text: '4', value: '4' },
                  { text: '5', value: '5' },
                ],
              },
              {
                name: 'Создать группы',
                integration: {
                  url: `${
                    process.env.VERCEL_URL || 'https://mattermost-bot-vert.vercel.app'
                  }/create-groups`,
                  context: {
                    action: 'create_groups',
                  },
                },
                type: 'button',
              },
            ],
          },
        ],
      },
    };

    console.log('Отправляем пост в канал...');

    // Пробуем через SDK, если не получается - через HTTP
    try {
      await client.createPost(message);
      console.log('Пост успешно отправлен через SDK');
    } catch (sdkError) {
      console.log('SDK не работает, отправляем через HTTP...');
      // Для HTTP нужно отправить как строку, не как объект с props
      const simpleMessage =
        'Меню создания групп будет доступно в следующем обновлении. Пока используйте команду напрямую.';
      await createPostHttp(channelId, simpleMessage);
    }
  } catch (error) {
    console.error('Ошибка при создании поста:', error.message);
    if (error.message.includes('404')) {
      console.error('404: Проверьте channel_id или доступ бота к каналу');
    }
    throw error;
  }
}

// Хранение выбранных данных
const sessions = {};

// Инициализация клиента при старте (убираем process.exit для Vercel)
async function initializeClient() {
  console.log('Инициализация Mattermost клиента...');
  const isAuth = await testAuth();
  if (!isAuth) {
    console.error('Не удалось авторизоваться в Mattermost. Продолжаем работу...');
    return false;
  }
  return true;
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  console.log('Получена команда /groupbot:', req.body);
  const { channel_id, user_id, text } = req.body;

  try {
    // Проверяем аутентификацию перед обработкой команды
    const isAuth = await initializeClient();
    if (!isAuth) {
      console.error('Не удалось авторизоваться для выполнения команды');
      res.json({
        response_type: 'ephemeral',
        text: 'Ошибка авторизации бота. Проверьте токен и права доступа.',
      });
      return;
    }

    // Простая команда для создания групп без интерактивных элементов
    if (text && text.includes('create')) {
      const users = await getUsers();
      if (users.length === 0) {
        res.json({
          response_type: 'ephemeral',
          text: 'Не удалось получить список пользователей.',
        });
        return;
      }

      const groupSize = 3; // По умолчанию
      const groups = createGroups(users, groupSize);

      let response = '## Сформированные группы:\n\n';
      groups.forEach((group, index) => {
        const members = group.map((user) => `@${user.username}`).join(', ');
        response += `**Группа ${index + 1}:** ${members}\n`;
      });

      // Отправляем результат в канал
      try {
        await client.createPost({
          channel_id,
          message: response,
        });
        res.json({
          response_type: 'ephemeral',
          text: 'Группы успешно созданы!',
        });
      } catch (postError) {
        console.error('Ошибка отправки поста через SDK, пробуем HTTP...');
        await createPostHttp(channel_id, response);
        res.json({
          response_type: 'ephemeral',
          text: 'Группы успешно созданы!',
        });
      }
    } else {
      // Показываем справку
      res.json({
        response_type: 'ephemeral',
        text: 'Используйте `/groupbot create` для создания случайных групп из участников команды.',
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

app.post('/select-users', async (req, res) => {
  console.log('Выбор пользователей:', req.body);
  const { user_id } = req.body.context || req.body;
  const { selected_option } = req.body;

  if (!sessions[user_id]) {
    sessions[user_id] = { selectedUsers: [], groupSize: 2 };
  }

  if (selected_option && selected_option.value) {
    if (!sessions[user_id].selectedUsers.includes(selected_option.value)) {
      sessions[user_id].selectedUsers.push(selected_option.value);
    }
  }

  res.json({
    update: {
      message: `Выбрано пользователей: ${sessions[user_id].selectedUsers.length}`,
    },
  });
});

app.post('/select-size', async (req, res) => {
  console.log('Выбор размера группы:', req.body);
  const { user_id } = req.body.context || req.body;
  const { selected_option } = req.body;

  if (!sessions[user_id]) {
    sessions[user_id] = { selectedUsers: [], groupSize: 2 };
  }

  if (selected_option && selected_option.value) {
    sessions[user_id].groupSize = parseInt(selected_option.value, 10) || 2;
  }

  res.json({
    update: {
      message: `Размер группы: ${sessions[user_id].groupSize}`,
    },
  });
});

app.post('/create-groups', async (req, res) => {
  console.log('Создание групп:', req.body);
  const { channel_id, user_id } = req.body.context || req.body;

  if (!sessions[user_id] || sessions[user_id].selectedUsers.length === 0) {
    res.json({
      response_type: 'ephemeral',
      text: 'Выберите пользователей перед созданием групп!',
    });
    return;
  }

  try {
    const users = await Promise.all(
      sessions[user_id].selectedUsers.map(async (id) => {
        try {
          // Пробуем через SDK, если не работает - через HTTP
          try {
            return await client.getUser(id);
          } catch (sdkError) {
            const cleanToken = botToken.replace('Bearer ', '');
            const response = await fetch(`${mattermostUrl}/api/v4/users/${id}`, {
              headers: {
                Authorization: `Bearer ${cleanToken}`,
                'Content-Type': 'application/json',
              },
            });
            if (response.ok) {
              return await response.json();
            }
            throw new Error(`HTTP ${response.status}`);
          }
        } catch (error) {
          console.error(`Ошибка получения пользователя ${id}:`, error.message);
          return null;
        }
      }),
    );

    const validUsers = users.filter((user) => user !== null);

    if (validUsers.length === 0) {
      res.json({
        response_type: 'ephemeral',
        text: 'Не удалось получить информацию о выбранных пользователях!',
      });
      return;
    }

    const groups = createGroups(validUsers, sessions[user_id].groupSize);

    let response = '## Сформированные группы:\n\n';
    groups.forEach((group, index) => {
      const members = group.map((user) => `@${user.username}`).join(', ');
      response += `**Группа ${index + 1}:** ${members}\n`;
    });

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
      response_type: 'ephemeral',
      text: 'Группы успешно созданы!',
    });
  } catch (error) {
    console.error('Ошибка при создании групп:', error);
    res.json({
      response_type: 'ephemeral',
      text: `Ошибка при создании групп: ${error.message}`,
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
    const users = await getUsers();
    res.json({
      timestamp: new Date().toISOString(),
      mattermost_url: mattermostUrl,
      token_present: !!botToken,
      token_format: botToken
        ? botToken.startsWith('Bearer')
          ? 'with_bearer'
          : 'without_bearer'
        : 'missing',
      users_count: users.length,
      sample_users: users
        .slice(0, 3)
        .map((u) => ({ id: u.id, username: u.username, is_bot: u.is_bot })),
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Инициализация при старте (не блокируем запуск)
initializeClient().catch((error) => {
  console.error('Ошибка инициализации:', error.message);
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

export default app;
