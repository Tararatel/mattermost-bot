import 'dotenv/config';
import { Client4 } from '@mattermost/client';
import express from 'express';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфигурация Mattermost
const mattermostUrl =
  process.env.MATTERMOST_URL || 'https://elbrus-mattermost.ignorelist.com';
const botToken = process.env.BOT_TOKEN || 'z9e754fjpjfz7dwd6rozjg51xe';

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

// Устанавливаем токен с префиксом Bearer
if (botToken.startsWith('Bearer ')) {
  client.setToken(botToken);
} else {
  client.setToken(`Bearer ${botToken}`);
}

console.log('Клиент настроен с URL:', mattermostUrl);

// Проверка аутентификации
async function testAuth() {
  try {
    console.log('Попытка авторизации...');
    const me = await client.getMe();
    console.log('Авторизация успешна. Пользователь:', {
      id: me.id,
      username: me.username,
      roles: me.roles,
    });
    return true;
  } catch (error) {
    console.error('Ошибка авторизации:', {
      message: error.message,
      status: error.status_code,
      url: error.url,
    });

    // Попробуем без префикса Bearer
    try {
      console.log('Попытка авторизации без префикса Bearer...');
      client.setToken(botToken.replace('Bearer ', ''));
      const me = await client.getMe();
      console.log('Авторизация успешна без Bearer. Пользователь:', me.username);
      return true;
    } catch (secondError) {
      console.error('Вторая попытка авторизации также неудачна:', secondError.message);
      return false;
    }
  }
}

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

// Получение списка пользователей с улучшенной обработкой ошибок
async function getUsers() {
  try {
    console.log('Запрашиваем список пользователей...');

    // Проверяем аутентификацию перед запросом
    try {
      await client.getMe();
      console.log('Проверка аутентификации прошла успешно');
    } catch (authError) {
      console.log('Ошибка аутентификации, попытка переустановить токен...');
      // Переустанавливаем токен
      if (botToken.startsWith('Bearer ')) {
        client.setToken(botToken);
      } else {
        client.setToken(botToken);
      }

      // Повторная проверка
      await client.getMe();
      console.log('Повторная аутентификация успешна');
    }

    const users = [];
    let page = 0;
    const perPage = 60; // Уменьшаем размер страницы
    let hasMore = true;

    while (hasMore && page < 10) {
      // Ограничиваем количество страниц
      try {
        console.log(`Запрашиваем страницу ${page}...`);
        const pageUsers = await client.getProfiles(page, perPage);
        console.log(
          `Получено пользователей на странице ${page}:`,
          typeof pageUsers,
          Object.keys(pageUsers || {}).length,
        );

        if (Array.isArray(pageUsers)) {
          users.push(...pageUsers);
          hasMore = pageUsers.length === perPage;
        } else if (pageUsers && typeof pageUsers === 'object') {
          // Mattermost API возвращает объект, где ключи - это ID пользователей
          const userArray = Object.values(pageUsers);
          console.log(`Преобразован объект в массив: ${userArray.length} пользователей`);
          users.push(...userArray);
          hasMore = userArray.length === perPage;
        } else {
          console.log('Неожиданный формат ответа:', pageUsers);
          break;
        }

        page++;
      } catch (pageError) {
        console.error(`Ошибка получения страницы ${page}:`, pageError.message);
        break;
      }
    }

    console.log(`Всего получено пользователей: ${users.length}`);
    const filteredUsers = users.filter((user) => !user.is_bot && user.delete_at === 0);
    console.log(`Фильтровано пользователей: ${filteredUsers.length}`);
    return filteredUsers;
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
    // Проверяем аутентификацию перед обработкой команды
    const isAuth = await initializeClient();
    if (!isAuth) {
      console.error('Не удалось авторизоваться для выполнения команды');
      res.json({
        response_type: 'ephemeral',
        text: 'Ошибка авторизации бота. Обратитесь к администратору.',
      });
      return;
    }

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
