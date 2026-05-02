const express = require('express');
const { Log } = require('logging-middleware');
const { fetchDepots } = require('../services/depots');
const { fetchVehicles } = require('../services/vehicles');
const { solveKnapsack } = require('../services/scheduler');

const router = express.Router();

// GET /schedule
// Returns the optimal task selection per depot. The /vehicles API in the spec
// does not include a depot association in its response shape, so each depot
// is solved against the full task pool. If the upstream API is later updated
// to expose `?depotId=` filtering, swap in fetchVehiclesForDepot(depot.id) here.
router.get('/schedule', async (req, res) => {
  try {
    await Log('backend', 'info', 'handler', 'GET /schedule received');

    const [depots, vehicles] = await Promise.all([fetchDepots(), fetchVehicles()]);

    const result = depots.map((depot) => {
      const { selected, totalDuration, totalImpact } = solveKnapsack(vehicles, depot.mechanicHours);
      return {
        depotId: depot.id,
        mechanicHours: depot.mechanicHours,
        totalDuration,
        totalImpact,
        scheduledTaskCount: selected.length,
        scheduledTasks: selected.map((t) => ({
          taskId: t.taskId,
          duration: t.duration,
          impact: t.impact,
        })),
      };
    });

    await Log('backend', 'info', 'handler',
      `GET /schedule ok — ${result.length} depot(s), total tasks scheduled: ${result.reduce((s, r) => s + r.scheduledTaskCount, 0)}`);

    res.json({ schedules: result });
  } catch (err) {
    await Log('backend', 'error', 'handler', `GET /schedule failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /schedule/:depotId — solve for a single depot
router.get('/schedule/:depotId', async (req, res) => {
  const depotId = Number(req.params.depotId);
  if (!Number.isFinite(depotId)) {
    await Log('backend', 'warn', 'handler', `GET /schedule/:depotId rejected — non-numeric id "${req.params.depotId}"`);
    return res.status(400).json({ error: 'depotId must be a number' });
  }

  try {
    await Log('backend', 'info', 'handler', `GET /schedule/${depotId} received`);

    const [depots, vehicles] = await Promise.all([fetchDepots(), fetchVehicles()]);
    const depot = depots.find((d) => d.id === depotId);

    if (!depot) {
      await Log('backend', 'warn', 'handler', `depot ${depotId} not found`);
      return res.status(404).json({ error: `depot ${depotId} not found` });
    }

    const { selected, totalDuration, totalImpact } = solveKnapsack(vehicles, depot.mechanicHours);

    await Log('backend', 'info', 'handler',
      `GET /schedule/${depotId} ok — ${selected.length} task(s), impact=${totalImpact}, duration=${totalDuration}/${depot.mechanicHours}`);

    res.json({
      depotId: depot.id,
      mechanicHours: depot.mechanicHours,
      totalDuration,
      totalImpact,
      scheduledTaskCount: selected.length,
      scheduledTasks: selected.map((t) => ({
        taskId: t.taskId,
        duration: t.duration,
        impact: t.impact,
      })),
    });
  } catch (err) {
    await Log('backend', 'error', 'handler', `GET /schedule/${depotId} failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
