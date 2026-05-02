# vehicle_maintenance_scheduler

Express microservice that, given a depot's mechanic-hour budget and a list of pending vehicle maintenance tasks (each with a duration and an operational-impact score), returns the subset of tasks that maximises total impact within the budget. This is a classic **0/1 knapsack** problem solved with pseudo-polynomial DP — `O(n × W)` time, `O(n × W)` memory.

## Architecture

```
            +-----------------------------+
GET /schedule  ─►  routes/schedule.js  ─┐
                                         │
                                         ├─►  services/depots.js   ─►  GET /evaluation-service/depots
                                         ├─►  services/vehicles.js ─►  GET /evaluation-service/vehicles
                                         └─►  services/scheduler.js  (0/1 knapsack solver)
                                                  │
                                                  ▼
                                          response { schedules[] }

every operation logs through logging-middleware → POST /evaluation-service/logs
```

### Files

- `src/server.js` — Express bootstrap, request log middleware, error handler, route mounting.
- `src/routes/schedule.js` — `GET /schedule`, `GET /schedule/:depotId`. Composes depots, vehicles, and the solver.
- `src/services/depots.js` — fetches depots, normalises `{ id, mechanicHours }`.
- `src/services/vehicles.js` — fetches vehicle tasks, normalises `{ taskId, duration, impact }`.
- `src/services/scheduler.js` — `solveKnapsack(tasks, budget)`; pure function, no I/O.
- `src/lib/eval-client.js` — shared authed `fetch` helper. Reuses the logging middleware's auth/token-refresh code so we don't duplicate credential handling.

## API

### `GET /schedule`

Solves the knapsack for every depot returned by `/depots`, against the full task list returned by `/vehicles`. The upstream `/vehicles` API doesn't include a depot association in its response, so each depot is solved against the full pool. If that API later starts returning a `DepotID` field (or accepts a `?depotId=` query param), filter inside `services/vehicles.js`.

**Response 200:**

```json
{
  "schedules": [
    {
      "depotId": 1,
      "mechanicHours": 60,
      "totalDuration": 60,
      "totalImpact": 187,
      "scheduledTaskCount": 18,
      "scheduledTasks": [
        { "taskId": "0bf780cb-1099-4f61-99bf-dec95a7063b6", "duration": 3, "impact": 10 },
        { "taskId": "9e08defa-7bb5-4a83-9e29-417165922894", "duration": 6, "impact": 9 }
      ]
    }
  ]
}
```

### `GET /schedule/:depotId`

Same shape, single depot. `404` if the depot doesn't exist, `400` if the id isn't numeric.

### `GET /health`

`{ "status": "ok" }`. No upstream calls, no auth.

## Algorithm — why 0/1 knapsack DP

Tasks can't be split (you can't half-fix a vehicle), so this is **0/1**, not fractional. Greedy by impact/duration density doesn't give the optimum. The DP runs in `O(n × W)` where `W` is the depot's mechanic-hour budget. With the scale shown in the spec (`W ≤ ~200`, `n` in the thousands) this is trivially fast — well under 1ms per depot. The reconstruction table uses `Float64Array` rows so it stays packed in memory.

Two escape hatches if `W` ever explodes (sub-hour granularity scaled by 100, multi-day budgets in the thousands):

1. **Greedy 2-approximation** — sort by `impact / duration`, take while budget allows. Fast and within 50% of optimal.
2. **FPTAS** — scale impacts down to a polynomial range and run DP keyed by impact instead of weight. Guarantees `(1 − ε)` of optimal.

The current code is correct and fast enough for the spec; switching strategies only matters if the scale shifts.

## Running

```bash
# from repo root, after creating secrets.local.json (see ../README.md)
cd vehicle_maintenance_scheduler
npm install
npm start

# in another shell
curl http://localhost:3000/schedule
curl http://localhost:3000/schedule/1
```

## Logging

Every successful operation (depot fetch, vehicle fetch, request received, request completed) emits an `info` log via the logging middleware. Warnings on bad input (e.g. unknown depot id), errors on upstream failures, fatals on unhandled exceptions. The middleware never throws — failed log calls are swallowed so that logging never breaks the request path.
