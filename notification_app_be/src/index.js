const { Log } = require('logging-middleware');
const { fetchNotifications } = require('./services/notifications');
const { topNNotifications, priorityScore, TYPE_WEIGHT } = require('./priority-inbox');

const N = Number(process.env.TOP_N) || 10;

function formatRow(rank, notif) {
  return [
    String(rank).padStart(4),
    (notif.Type || '?').padEnd(9),
    (notif.Timestamp || '').padEnd(19),
    (notif.ID || '').padEnd(36),
    (notif.Message || '').slice(0, 40),
  ].join(' | ');
}

async function main() {
  await Log('backend', 'info', 'service', `priority-inbox starting; top-n=${N}`);
  console.log(`Priority Inbox — fetching notifications and selecting top ${N}`);
  console.log(`Weights: Placement=${TYPE_WEIGHT.Placement} Result=${TYPE_WEIGHT.Result} Event=${TYPE_WEIGHT.Event}\n`);

  const notifications = await fetchNotifications();
  console.log(`fetched ${notifications.length} notification(s) from /evaluation-service/notifications\n`);

  const top = topNNotifications(notifications, N);

  console.log(`Top ${top.length}:\n`);
  console.log('rank | type      | timestamp           | id                                    | message');
  console.log('-----|-----------|---------------------|---------------------------------------|---------');
  top.forEach((n, i) => console.log(formatRow(i + 1, n)));
  console.log();

  // Surface the score for debugging / verification
  if (process.env.SHOW_SCORES === '1') {
    console.log('scores:');
    top.forEach((n, i) => console.log(`  #${i + 1}  ${priorityScore(n).toExponential(3)}  ${n.Type}  ${n.Timestamp}`));
  }

  await Log('backend', 'info', 'service', `priority-inbox ok; surfaced=${top.length} of ${notifications.length}`);
}

main().catch(async (err) => {
  await Log('backend', 'error', 'service', `priority-inbox failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
