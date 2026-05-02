const { authedGet } = require('../lib/eval-client');
const { Log } = require('logging-middleware');

async function fetchDepots() {
  const data = await authedGet('/depots');
  const depots = Array.isArray(data?.depots) ? data.depots : [];
  await Log('backend', 'info', 'service', `fetched ${depots.length} depot(s)`);
  return depots.map((d) => ({
    id: d.ID,
    mechanicHours: Number(d.MechanicHours) || 0,
  }));
}

module.exports = { fetchDepots };
