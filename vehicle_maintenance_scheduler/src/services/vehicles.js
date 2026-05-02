const { authedGet } = require('../lib/eval-client');
const { Log } = require('logging-middleware');

async function fetchVehicles() {
  const data = await authedGet('/vehicles');
  const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];
  await Log('backend', 'info', 'service', `fetched ${vehicles.length} vehicle task(s)`);
  return vehicles.map((v) => ({
    taskId: v.TaskID,
    duration: Number(v.Duration) || 0,
    impact: Number(v.Impact) || 0,
  }));
}

module.exports = { fetchVehicles };
