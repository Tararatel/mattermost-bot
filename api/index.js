require('dotenv').config();
const { Client4 } = require('mattermost-client');
const express = require('express');
const app = express();

app.use(express.json());

// Конфигурация Mattermost
const mattermostUrl = process.env.MATTERMOST_URL;
const botToken = process.env.BOT_TOKEN;

const client = new Client4();
client.setUrl(mattermostUrl);
client.setToken(botToken);

// Получение списка пользователей
async function getUsers() {
  try {
    const users = await client.getAllUsers();
    return users.filter((user) => !user.is_bot && user.delete_at === 0);
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
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
  const users = await getUsers();
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

  await client.createPost(message);
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
