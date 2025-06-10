import 'dotenv/config';
import { Client4 } from '@mattermost/client';
import express from 'express';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфигурация Mattermost
const mattermostUrl =
  process.env.MATTERMOST_URL || 'https://elbrus-mattermost.ignorelist.com';
const botToken = process.env.BOT_TOKEN || 'kwo7ijukwfrg3qzufukwpz3q5y';

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
client.setToken(botToken);

// Проверка аутентификации
async function testAuth() {
  try {
    const me = await client.getMe();
    console.log('Авторизация успешна. Пользователь:', me.username);
    return true;
  } catch (error) {
    console.error('Ошибка авторизации:', error.message);
    return false;
  }
}

// Инициализация клиента при старте
async function initializeClient() {
  console.log('Инициализация Mattermost клиента...');
  const isAuth = await testAuth();
  if (!isAuth) {
    console.error('Не удалось авторизоваться в Mattermost');
    process.exit(1);
  }
}

// Получение списка пользователей с улучшенной обработкой ошибок
async function getUsers() {
  try {
    console.log('Запрашиваем список пользователей...');

    // Проверяем аутентификацию перед запросом
    await client.getMe();

    const users = [];
    let page = 0;
    const perPage = 200;
    let hasMore = true;

    while (hasMore) {
      try {
        const pageUsers = await client.getProfiles(page, perPage);
        console.log(`Получено ${pageUsers.length} пользователей на странице ${page}`);

        if (Array.isArray(pageUsers)) {
          users.push(...pageUsers);
          hasMore = pageUsers.length === perPage;
        } else {
          console.log('Получен объект вместо массива, преобразуем...');
          const userArray = Object.values(pageUsers);
          users.push(...userArray);
          hasMore = userArray.length === perPage;
        }

        page++;
      } catch (pageError) {
        console.error(`Ошибка получения страницы ${page}:`, pageError.message);
        break;
      }
    }

    const filteredUsers = users.filter((user) => !user.is_bot && user.delete_at === 0);
    console.log(`Фильтровано пользователей: ${filteredUsers.length}`);
    return filteredUsers;
  } catch (error) {
    console.error('Ошибка получения пользователей:', error.message);

    // Если ошибка аутентификации, попробуем переподключиться
    if (error.message.includes('Invalid or expired session')) {
      console.log('Попытка повторной аутентификации...');
      client.setToken(botToken);

      try {
        await client.getMe();
        console.log('Повторная аутентификация успешна');
        return await getUsers(); // Рекурсивный вызов после переподключения
      } catch (reAuthError) {
        console.error('Повторная аутентификация не удалась:', reAuthError.message);
      }
    }

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
    await client.createPost(message);
    console.log('Пост успешно отправлен');
  } catch (error) {
    console.error('Ошибка при создании поста:', error.message);
    if (error.status_code === 404) {
      console.error('404: Проверьте channel_id или доступ бота к каналу');
    }
    throw error;
  }
}

// Хранение выбранных данных
const sessions = {};

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  console.log('Получена команда /groupbot:', req.body);
  const { channel_id, user_id } = req.body;

  try {
    await createInteractiveMessage(channel_id);
    res.json({
      response_type: 'ephemeral',
      text: 'Меню бота открыто! Выберите пользователей и размер группы.',
    });
  } catch (error) {
    console.error('Ошибка при создании меню:', error);
    res.json({
      response_type: 'ephemeral',
      text: `Ошибка при открытии меню: ${error.message}`,
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
          return await client.getUser(id);
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

    await client.createPost({
      channel_id,
      message: response,
    });

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
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Инициализация при старте
initializeClient().catch(console.error);

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

export default app;
