# notification_app_be — Stage 6 Priority Inbox

Top-N priority notification surfacer. Fetches from the protected `/evaluation-service/notifications` endpoint and prints the highest-priority notifications first, where priority combines **type weight** (`Placement > Result > Event`) and **recency** (newer beats older within a type).

## Priority formula

```
score(n) = TYPE_WEIGHT[n.Type] * 1e15 + epochMs(n.Timestamp)

TYPE_WEIGHT = { Placement: 3, Result: 2, Event: 1 }
```

The multiplier `1e15` is larger than any plausible epoch-ms timestamp, so type weight strictly dominates and timestamp is a pure tiebreaker. Result: every Placement outranks every Result regardless of age; within the same type, newer wins.

## Why a min-heap (and not `sort + slice(0, n)`)

| Approach | Time per N inputs | Per-arrival update | Memory |
|---|---|---|---|
| `sort + slice(0, n)` | `O(N log N)` | `O(N log N)` | `O(N)` |
| **bounded min-heap (size n)** | `O(N log n)` | `O(log n)` | `O(n)` |

For n = 10 the heap does ~3.3 ops per notification regardless of N. More importantly, when new notifications stream in (websocket subscription, polling loop, message bus), comparing a new arrival to the heap root is `O(1)` and a possible admit is `O(log n)`. The sort approach has to redo `O(N log N)` work on every arrival.

The heap holds at most `n` items. The smallest score sits at the root, so:

- if heap not full → push
- if `newScore > rootScore` → replace root, sift down
- else → discard

## Files

- `src/priority-inbox.js` — `priorityScore`, `BoundedMinHeap`, `topNNotifications`, `PriorityInbox` class for live ingest. Pure, no I/O, easy to test.
- `src/services/notifications.js` — fetches `/evaluation-service/notifications`.
- `src/lib/eval-client.js` — shared authed `fetch` (uses the logging-middleware's auth + token-refresh).
- `src/index.js` — entrypoint. Fetches, computes top-N, prints a ranked table, logs progress.
- `examples/synthetic.js` — runs the same logic against fixed in-memory data so you can verify the ordering without hitting the network.

## Run

```bash
# from repo root, after creating ../secrets.local.json
cd notification_app_be
npm install

# top 10 from the real API
npm start

# top 25
TOP_N=25 npm start

# show the raw priority scores too
SHOW_SCORES=1 npm start

# verify logic with synthetic data — no API call needed
npm run example
```

## Sample output

```
Priority Inbox — fetching notifications and selecting top 10
Weights: Placement=3 Result=2 Event=1

fetched 30 notification(s) from /evaluation-service/notifications

Top 10:

rank | type      | timestamp           | id                                    | message
-----|-----------|---------------------|---------------------------------------|---------
   1 | Placement | 2026-04-22 17:51:18 | b283218f-ea5a-4b7c-93a9-1f2f240d64b0  | CSX Corporation hiring
   2 | Placement | 2026-04-22 17:49:42 | 8a7412bd-6065-4d09-8501-a37f11cc848b  | Advanced Micro Devices Inc. hiring
   3 | Result    | 2026-04-22 17:51:30 | d146095a-0d86-4a34-9e69-3900a14576bc  | mid-sem
   4 | Result    | 2026-04-22 17:50:54 | 0005513a-142b-4bbc-8678-eefec65e1ede  | mid-sem
   5 | Result    | 2026-04-22 17:50:42 | ea836726-c25e-4f21-a72f-544a6af8a37f  | project-review
   ...
```

All Placements first (newest first), then all Results (newest first), then Events. That's the strict-tuple ordering — exactly what "weight (placement > result > event) and recency" specifies.

## Maintaining top-N efficiently as new notifications arrive

Use the `PriorityInbox` class:

```js
const { PriorityInbox } = require('./src/priority-inbox');

const inbox = new PriorityInbox(10);

// initial seed
inbox.ingestMany(await fetchNotifications());

// streaming arrivals (e.g. inside a websocket onmessage handler)
ws.on('message', (raw) => {
  const event = JSON.parse(raw);
  if (event.type === 'notification.created') inbox.ingest(event.data);
  // ... re-render UI from inbox.top() if the heap changed
});
```

`ingest()` returns `true` if the new notification made it into the top-N (i.e. the UI needs a refresh) and `false` if it was discarded. That's the cheapest possible "did anything change" check — just one comparison against the heap root, no diffing of two ranked lists.

## Logging

Every operation logs through `logging-middleware` — `info` on fetch + completion, `error` on upstream failure. The middleware never throws (failed log calls are swallowed) so logging never breaks the app's main flow.
