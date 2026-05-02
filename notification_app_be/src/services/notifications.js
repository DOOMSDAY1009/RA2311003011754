const { authedGet } = require('../lib/eval-client');
const { Log } = require('logging-middleware');

async function fetchNotifications() {
  const data = await authedGet('/notifications');
  const list = Array.isArray(data?.notifications) ? data.notifications : [];
  await Log('backend', 'info', 'service', `fetched ${list.length} notification(s)`);
  return list;
}

module.exports = { fetchNotifications };
