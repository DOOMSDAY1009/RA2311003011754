const express = require('express');
const { Log } = require('logging-middleware');
const scheduleRouter = require('./routes/schedule');

const app = express();
app.use(express.json());

app.use(async (req, _res, next) => {
  await Log('backend', 'info', 'middleware', `${req.method} ${req.url}`);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(scheduleRouter);

app.use(async (err, _req, res, _next) => {
  await Log('backend', 'fatal', 'middleware', `unhandled error: ${err.message}`);
  res.status(500).json({ error: 'internal_error' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, async () => {
  await Log('backend', 'info', 'service', `vehicle_maintenance_scheduler listening on :${PORT}`);
  console.log(`vehicle_maintenance_scheduler listening on http://localhost:${PORT}`);
  console.log(`  GET /schedule              — solve for all depots`);
  console.log(`  GET /schedule/:depotId     — solve for one depot`);
  console.log(`  GET /health                — health check`);
});
