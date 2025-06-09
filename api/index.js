require('dotenv').config();
const { Client4 } = require('mattermost-client');
const express = require('express');
const app = express();

app.use(express.json());

// Конфигурация Mattermost
const mattermostUrl = process.env.MATTERMOST_URL;
const botToken = process.env.BOT_TOKEN;
const port = process.env.PORT || 3000;

// Инициализация клиента Mattermost
const client = new Client4();
client.setUrl(mattermostUrl);
client.setToken(botToken);

// Получение списка пользователей
async function getUsers() {
  try {
    const users = await client.getAllUsers();
    return users.filter(user => !user.is_bot && user.delete_at === 0);
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
  const userOptions = users.map(user => ({
    text: user.username,
    value: user.id
  }));

  const message = {
    channel_id: channelId,
    message: 'Создать группы пользователей',
    props: {
      attachments: [{
        text: 'Выберите пользователей и размер группы',
        actions: [
          {
            name: 'Выбрать пользователей',
            integration: {
              url: `http://localhost:${port}/select-users`,
              context: {
                action: 'select_users'
              }
            },
            type: 'select',
            options: userOptions
          },
          {
            name: 'Размер группы',
            integration: {
              url: `http://localhost:${port}/select-size`,
              context: {
                action: 'select_size'
              }
            },
            type: 'select',
            options: [
              { text: '2', value: '2' },
              { text: '3', value: '3' },
              { text: '5', value: '5' }
            ]
          },
          {
            name: 'Создать группы',
            integration: {
              url: `http://localhost:${port}/create-groups`,
              context: {
                action: 'create_groups'
              }
            },
            type: 'button'
          }
        ]
      }]
    }
  };

  await client.createPost(message);
}

// Обработка Slash-команды /groupbot
app.post('/groupbot', async (req, res) => {
  const { channel_id } = req.body;
  await createInteractiveMessage(channel_id);
  res.json({ response_type: 'ephemeral', text: 'Меню бота открыто!' });
});

// Хранение выбранных данных
let selectedUsers = [];
let groupSize = 2;

// Обработка выбора пользователей
app.post('/select-users', async (req, res) => {
  const { user_ids } = req.body.context;
  selectedUsers = user_ids.split(',');
  res.json({ update: { message: `Выбрано пользователей: ${selectedUsers.length}` } });
});

// Обработка выбора размера группы
app.post('/select-size', async (req, res) => {
  groupSize = parseInt(req.body.context.value, 10);
  res.json({ update: { message: `Размер группы: ${groupSize}` } });
});

// Обработка создания групп
app.post('/create-groups', async (req, res) => {
  const { channel_id } = req.body;
  if (selectedUsers.length === 0) {
    res.json({ response_type: 'ephemeral', text: 'Выберите пользователей!' });
    return;
  }

  const users = await Promise.all(selectedUsers.map(id => client.getUser(id)));
  const groups = createGroups(users, groupSize);

  let response = 'Сформированные группы:\n';
  groups.forEach((group, index) => {
    const members = group.map(user => `@${user.username}`).join(', ');
    response += `Группа ${index + 1}: ${members}\n`;
  });

  await client.createPost({
    channel_id,
    message: response
  });

  res.json({ response_type: 'ephemeral', text: 'Группы созданы!' });
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

// Подключение WebSocket
const ws = client.initWebSocket();
ws.on('open', () => {
  console.log('WebSocket подключен');
});