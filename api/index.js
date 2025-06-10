import 'dotenv/config';
import { Client4 } from '@mattermost/client';
import express from 'express';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфигурация Mattermost
const mattermostUrl = 'https://elbrus-mattermost.ignorelist.com/';
const botToken = 'kwo7ijukwfrg3qzufukwpz3q5y';

console.log('Загруженные переменные окружения:', {
  mattermostUrl,
  botToken: botToken ? 'установлен' : 'отсутствует',
});
if (!mattermostUrl || !botToken) {
  console.error(
    'Ошибка: MATTERMOST_URL или BOT_TOKEN отсутствуют в переменных окружения',
  );
  process.exit(1); // Завершаем процесс, если переменные не заданы
}

const client = new Client4();
client.setUrl(mattermostUrl);
client.setToken(botToken);

async function testAuth() {
  try {
    const me = await client.getMe();
    console.log('Авторизация успешна. Пользователь:', me.username);
    return true;
  } catch (error) {
    console.error('Ошибка авторизации:', error.message, error.stack);
    return false;
  }
}

console.log(client, 'client');


testAuth();

// Получение списка пользователей
async function getUsers() {
  try {
    console.log('Запрашиваем список пользователей...');
    const users = [];
    let page = 0;
    const perPage = 200;
    let hasMore = true;
    while (hasMore) {
      const pageUsers = await client.getProfiles(0, perPage, page * perPage); // page, perPage, offset
      console.log(`Получено ${pageUsers.length} пользователей на странице ${page}`);
      users.push(...pageUsers);
      hasMore = pageUsers.length === perPage;
      page++;
    }
    const filteredUsers = users.filter((user) => !user.is_bot && user.delete_at === 0);
    console.log(`Фильтровано пользователей: ${filteredUsers.length}`);
    return filteredUsers;
  } catch (error) {
    console.error('Ошибка получения пользователей:', error.message, error.stack);
    return [];
  }
}

// Генерация случайных групп
function createGroups(users, groupSize) {
  const shuffled = users.sort(() => 0.5 - Math.random());
  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }
  return groups;
}

// Формирование интерактивного сообщения
async function createInteractiveMessage(channelId) {
  console.log('Формируем интерактивное сообщение для канала:', channelId);
  const users = await getUsers();
  if (users.length === 0) {
    console.error('Список пользователей пуст');
    throw new Error('Не удалось получить список пользователей');
  }
  const userOptions = users.map((user) => ({
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
                url: 'https://mattermost-bot-vert.vercel.app/select-users',
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
                url: 'https://mattermost-bot-vert.vercel.app/select-size',
                context: {
                  action: 'select_size',
                },
              },
              type: 'select',
              options: [
                { text: '2', value: '2' },
                { text: '3', value: '3' },
                { text: '5', value: '5' },
              ],
            },
            {
              name: 'Создать группы',
              integration: {
                url: 'https://mattermost-bot-vert.vercel.app/create-groups',
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

  try {
    console.log('Отправляем пост в канал:', JSON.stringify(message));
    await client.createPost(message); // Передаем весь объект message
    console.log('Пост успешно отправлен');
  } catch (error) {
    console.error('Ошибка при создании поста:', error.message, error.stack);
    if (error.status_code === 404) {
      console.error('404: Проверьте channel_id или доступ бота к каналу');
    }
    throw error;
  }
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  const { channel_id } = req.body;
  try {
    await createInteractiveMessage(channel_id);
    res.json({ response_type: 'ephemeral', text: 'Меню бота открыто!' });
  } catch (error) {
    console.error('Ошибка при создании меню:', error);
    res.json({ response_type: 'ephemeral', text: 'Ошибка при открытии меню.' });
  }
});

// Хранение выбранных данных
const sessions = {};

app.post('/select-users', async (req, res) => {
  const { user_id } = req.body.context || {};
  if (!sessions[user_id]) sessions[user_id] = { selectedUsers: [], groupSize: 2 };
  const { user_ids } = req.body.context;
  sessions[user_id].selectedUsers = user_ids ? user_ids.split(',') : [];
  res.json({
    update: {
      message: `Выбрано пользователей: ${sessions[user_id].selectedUsers.length}`,
    },
  });
});

app.post('/select-size', async (req, res) => {
  const { user_id } = req.body.context || {};
  if (!sessions[user_id]) sessions[user_id] = { selectedUsers: [], groupSize: 2 };
  sessions[user_id].groupSize = parseInt(req.body.context.value, 10) || 2;
  res.json({ update: { message: `Размер группы: ${sessions[user_id].groupSize}` } });
});

app.post('/create-groups', async (req, res) => {
  const { channel_id, user_id } = req.body.context || req.body;
  if (!sessions[user_id] || sessions[user_id].selectedUsers.length === 0) {
    res.json({ response_type: 'ephemeral', text: 'Выберите пользователей!' });
    return;
  }

  try {
    const users = await Promise.all(
      sessions[user_id].selectedUsers.map((id) => client.getUser(id)),
    );
    const groups = createGroups(users, sessions[user_id].groupSize);

    let response = 'Сформированные группы:\n';
    groups.forEach((group, index) => {
      const members = group.map((user) => `@${user.username}`).join(', ');
      response += `Группа ${index + 1}: ${members}\n`;
    });

    await client.createPost({ channel_id, message: response });
    delete sessions[user_id];
    res.json({ response_type: 'ephemeral', text: 'Группы созданы!' });
  } catch (error) {
    console.error('Ошибка при создании групп:', error);
    res.json({ response_type: 'ephemeral', text: 'Ошибка при создании групп.' });
  }
});

// Запуск сервера
app.listen(process.env.PORT || 3000, () => {
  console.log(`Сервер запущен на порту ${process.env.PORT || 3000}`);
});
