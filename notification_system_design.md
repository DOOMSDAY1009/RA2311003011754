# Notification System — Design

Document for the Campus Notifications Microservice. Stages 1–5 are below; Stage 6 is added after the code lands in `notification_app_be/`.

---

## Stage 1 — REST API design

### Core actions

A campus notification platform needs to support these user-facing actions:

1. List my notifications (with filters: status, type, time range)
2. View a single notification
3. Mark one notification as read
4. Mark many / all notifications as read
5. Get my unread count (for the navbar badge)
6. Receive new notifications in real-time

And admin actions used by Placements / Events / Results staff:

7. Send a notification to one or many specific students
8. Broadcast a notification to a cohort or to all students

### Conventions

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <jwt>` on every request
- Error envelope: `{ "error": { "code": "string", "message": "string", "details": {} } }`, HTTP status reflects category
- Pagination: cursor-based (`?cursor=&limit=20`); OFFSET doesn't scale to millions of rows
- Naming: plural nouns; verbs only as resource-actions like `:mark-all-read`

### Endpoints

#### `GET /api/v1/users/{userId}/notifications`

List a student's notifications.

Query params:
- `status` — `unread` | `read` | `all` (default `unread`)
- `type` — `placement` | `result` | `event` (optional)
- `limit` — page size, max 100, default 20
- `cursor` — opaque token from a previous response

Response 200:
```json
{
  "data": [
    {
      "id": "d146095a-0d86-4a34-9e69-3900a14576bc",
      "type": "result",
      "title": "Mid-sem result published",
      "message": "Your mid-sem results are out",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:30Z",
      "readAt": null
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA0LTIyVDE3OjUxOjMwWiJ9"
}
```

#### `GET /api/v1/users/{userId}/notifications/{id}`

Single notification detail. 404 if not owned by `userId`.

#### `GET /api/v1/users/{userId}/notifications/unread-count`

Cheap call for the badge. Backed by a cached materialized counter (Stages 2 & 4).

```json
{ "unreadCount": 47 }
```

#### `PATCH /api/v1/users/{userId}/notifications/{id}`

Mark a single notification read or unread.

Request: `{ "isRead": true }`
Response 200: the updated notification.

#### `POST /api/v1/users/{userId}/notifications:mark-all-read`

Bulk mark-all-read. Returns the count updated.

```json
{ "updatedCount": 47 }
```

#### `POST /api/v1/notifications`  *(admin / service-to-service)*

Create a notification for one or many recipients.

Request:
```json
{
  "recipientIds": [101, 102, 103],
  "type": "placement",
  "title": "CSX Corporation hiring",
  "message": "Drive on 2026-05-10 at the auditorium",
  "payload": { "company": "CSX Corporation", "driveAt": "2026-05-10T09:00:00Z" }
}
```

Response 201:
```json
{ "createdCount": 3, "broadcastId": "8a7412bd-6065-4d09-8501-a37f11cc848b" }
```

For very large recipient lists (e.g. all 50K students) the API accepts a cohort filter and the actual fan-out is asynchronous — see Stage 5.

#### Standard request headers

```
Authorization: Bearer <jwt>
Content-Type: application/json
X-Request-Id: <uuid>          ; for tracing
Idempotency-Key: <uuid>       ; on POST endpoints
```

#### Standard response headers

```
Content-Type: application/json
X-Request-Id: <echoed back>
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1714657890
```

### Real-time notifications

Three options compared:

| Mechanism | Direction | Browser support | Scale concerns |
|---|---|---|---|
| **WebSocket** | bi-directional | universal | sticky sessions, connection count per node |
| Server-Sent Events (SSE) | server → client | universal except old Edge | one connection per client, simpler |
| Long polling | client pull | universal | a DB hit per poll — defeats the point |

**Choice: WebSocket**, with SSE as the documented fallback for restrictive networks. WebSocket gives sub-100 ms push latency and bidirectional delivery acks.

#### `WS /ws/notifications`

Client connects with the Bearer token in the `Sec-WebSocket-Protocol` header (or as the first message, per browser quirks). Server pushes JSON events as they happen.

Server → client:
```json
{ "event": "notification.created", "data": { "...same shape as GET..." } }
{ "event": "notification.updated", "data": { "id": "...", "isRead": true } }
{ "event": "ping", "ts": 1714657890 }
```

Client → server:
```json
{ "event": "pong", "ts": 1714657890 }
{ "event": "ack", "id": "..." }
```

#### Backend wiring

```
+--------+   write    +--------+    publish    +-----------+   push    +-------+
| API    | ─────────▶ |  DB    | ────────────▶ | Pub/Sub   | ────────▶ |  WS   | ─▶ client
| writer |  (txn +    |        |   (outbox →   | (Redis)   |           | gateway|
|        |   outbox)  |        |    bridge)    |           |           |       |
+--------+            +--------+               +-----------+           +-------+
```

Any node receiving a publish fans out to its locally-connected sockets, so WS gateway nodes scale horizontally. Reconnection clients get a `since=<lastEventId>` query on initial fetch to backfill anything missed during the disconnect window.

---

## Stage 2 — Persistent storage

### Storage choice: PostgreSQL

Recommended: **relational (PostgreSQL)**.

Why:
- Notifications have a fixed shape (recipient, type, message, timestamp, read flag). Schema-on-write is fine.
- We need transactional consistency: marking-read must not race with insert; cached counters must agree with row state.
- Rich indexing primitives — partial indexes (`WHERE is_read = false`) and composite indexes are essential for "unread for user X, latest first".
- Mature ops ecosystem: replication, pgBouncer, declarative partitioning, logical decoding for the outbox→Pub-Sub bridge.

NoSQL alternatives considered:
- **Cassandra / DynamoDB** — great for write-heavy time-series. Worth revisiting if write rate exceeds ~10K/sec sustained, or for free regional sharding.
- **MongoDB** — document model adds little; the schema is regular.
- **Redis** — used as a *cache* for unread counts and recent notifications, not as the source of truth.

### Schema

```sql
CREATE TYPE notification_type AS ENUM ('placement', 'result', 'event');

CREATE TABLE users (
  user_id    BIGSERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  notification_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id      BIGINT NOT NULL REFERENCES users(user_id),
  notification_type notification_type NOT NULL,
  title             TEXT NOT NULL,
  message           TEXT NOT NULL,
  payload           JSONB,
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at           TIMESTAMPTZ,
  broadcast_id      UUID
);

-- Hot path: list a user's unread, newest first
CREATE INDEX idx_notif_unread
  ON notifications (recipient_id, created_at DESC, notification_id DESC)
  WHERE is_read = FALSE;

-- Type filter for "show me only Placement notifications"
CREATE INDEX idx_notif_user_type_time
  ON notifications (recipient_id, notification_type, created_at DESC);

-- Cross-cutting analytics: "all students who got a Placement in last 7 days"
CREATE INDEX idx_notif_type_time
  ON notifications (notification_type, created_at DESC);

-- Materialized counter so the badge avoids COUNT(*)
CREATE TABLE user_notification_summary (
  user_id      BIGINT PRIMARY KEY REFERENCES users(user_id),
  unread_count BIGINT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ
);

-- Outbox for transactional event publishing (used by Stage 5's fan-out)
CREATE TABLE notification_outbox (
  outbox_id    BIGSERIAL PRIMARY KEY,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
```

### Problems as data volume grows

50K students × ~5 notifications/day = 250K rows/day, ~91M rows/year. Pain points:

| Problem | What happens | Mitigation |
|---|---|---|
| Index bloat | `idx_notif_unread` keeps growing as unread accumulates | Partition by `created_at` (monthly), drop / cold-archive old partitions |
| `COUNT(*)` on badge | Sequential scan even with partial index when the user has thousands unread | Maintain `user_notification_summary.unread_count` on insert/update |
| OFFSET-based pagination | Each page costs O(offset) | Cursor pagination on `(created_at, notification_id)` |
| Vacuum churn | Constant `is_read = true` updates rewrite tuples | HOT updates (no indexed-column changes), batch mark-read on the client |
| Hot insert ("notify all") | Lock contention on a single statement | Single `INSERT ... SELECT unnest($ids)` keeps it as one transaction |
| Cold archive | Old read notifications still on hot disk | Move read + `created_at < now() - interval '90d'` to `notifications_archive` |
| Single primary | All writes hit one node | Read replicas for list/count queries with read-your-writes routing for the writer |

### Sample queries (mapped to Stage 1 endpoints)

**List unread, paginated** (`GET /notifications?status=unread`):
```sql
SELECT notification_id, notification_type, title, message, created_at
FROM notifications
WHERE recipient_id = $1
  AND is_read = FALSE
  AND (created_at, notification_id) < ($2, $3)  -- cursor
ORDER BY created_at DESC, notification_id DESC
LIMIT 20;
```

**Mark single read** (`PATCH /notifications/{id}`):
```sql
BEGIN;
UPDATE notifications
SET is_read = TRUE, read_at = now()
WHERE notification_id = $1
  AND recipient_id = $2
  AND is_read = FALSE
RETURNING notification_id, read_at;

UPDATE user_notification_summary
SET unread_count = unread_count - 1
WHERE user_id = $2;
COMMIT;
```

**Mark all read**:
```sql
WITH updated AS (
  UPDATE notifications SET is_read = TRUE, read_at = now()
  WHERE recipient_id = $1 AND is_read = FALSE
  RETURNING 1
)
UPDATE user_notification_summary
SET unread_count = 0
WHERE user_id = $1;
```

**Unread count** (badge):
```sql
SELECT unread_count FROM user_notification_summary WHERE user_id = $1;
```

**Bulk insert (admin fan-out)**:
```sql
INSERT INTO notifications (recipient_id, notification_type, title, message, payload, broadcast_id)
SELECT unnest($1::bigint[]), $2, $3, $4, $5, $6
RETURNING notification_id, recipient_id;
```

---

## Stage 3 — Slow query analysis

> The exact query in the prompt was not visible in the screenshots provided. The analysis below assumes the typical naive form; the reasoning carries over to any equivalent variant.

```sql
SELECT *
FROM notifications
WHERE student_id = ?
  AND is_read = FALSE
ORDER BY created_at DESC;
```

### Is the query accurate?

Functionally yes — it returns a student's unread notifications newest-first. Correctness-wise it has problems:

- `SELECT *` ships every column, including the potentially-large `payload` JSONB, which is rarely needed in the list view.
- **No `LIMIT`**. If a student has 5,000 unread, all 5,000 cross the wire on every page load.
- **No tie-break** on `created_at`. Two rows at the same millisecond order non-deterministically across pages, causing duplicate or skipped rows during pagination. Add `, notification_id DESC`.

### Why is it slow?

With 50K students and 5M total rows, the average is ~100 per student, but a heavy user can have thousands. Without the right index:

1. **No useful index**: full table scan. 5M rows × cost-per-row, dominated by I/O.
2. **Index on `(student_id)` only**: lookup-by-student is fast, but the planner still reads *all* of that student's rows (read + unread), then filters and sorts in memory. For a 10K-row student that's 10K reads plus a sort.
3. **Index on `(student_id, is_read)`**: better — skips read rows — but still requires a sort because the index isn't ordered by `created_at`.
4. **Partial composite `(student_id, created_at DESC) WHERE is_read = FALSE`**: index-only scan returns rows already sorted; reads exactly the page count we need. This is what we want.

Likely production cause: the table has a generic `(student_id)` index, the planner does index-scan + filter + sort, and the sort spills to disk for heavy users.

### What I'd change

Add the partial composite index:
```sql
CREATE INDEX idx_notif_unread_v2
  ON notifications (student_id, created_at DESC, notification_id DESC)
  WHERE is_read = FALSE;
```

Rewrite the query:
```sql
SELECT notification_id, notification_type, title, message, created_at
FROM notifications
WHERE student_id = $1
  AND is_read = FALSE
ORDER BY created_at DESC, notification_id DESC
LIMIT 20;
```

### Computation cost

- **Before**: with N rows for that student, ~`O(N log N)` from the sort, plus heavy I/O reading every column of every unread row.
- **After**: `O(log T + K)` where T is total table rows and K is page size (20). Index is already sorted; no extra sort. JSONB payload not transferred.
- Empirically: hundreds of ms (with a 10K-row student) → under 5 ms.

### "Add indexes on every column" — is that good advice?

**No.** Three reasons:

1. **Writes pay the cost.** Every `INSERT` / `UPDATE` rewrites every index. With 5M existing rows and 250K writes/day, doubling the index count roughly doubles write amplification.
2. **Most won't be used.** The planner picks indexes based on observed query patterns. Indexes the optimiser never chooses are pure overhead.
3. **Storage and vacuum.** Each index occupies disk and participates in vacuum / reindex cycles. Unused indexes still get vacuumed.

The right rule: **add indexes for measured slow queries; periodically drop indexes that `pg_stat_user_indexes` shows as unused.** The handful in Stage 2 cover all real query patterns.

### Query: students who got a placement notification in the last 7 days

```sql
SELECT DISTINCT recipient_id
FROM notifications
WHERE notification_type = 'placement'
  AND created_at >= now() - INTERVAL '7 days';
```

This uses `idx_notif_type_time (notification_type, created_at DESC)` — index range scan on `created_at` within the placement type. `DISTINCT` deduplicates students who got multiple drives that week.

If we want full student records:
```sql
SELECT DISTINCT u.user_id, u.email, u.full_name
FROM users u
JOIN notifications n ON n.recipient_id = u.user_id
WHERE n.notification_type = 'placement'
  AND n.created_at >= now() - INTERVAL '7 days';
```

For very large windows or hot-path use, replace `DISTINCT` with `EXISTS`:
```sql
SELECT u.user_id, u.email, u.full_name
FROM users u
WHERE EXISTS (
  SELECT 1 FROM notifications n
  WHERE n.recipient_id = u.user_id
    AND n.notification_type = 'placement'
    AND n.created_at >= now() - INTERVAL '7 days'
);
```

Same plan, clearer intent, and avoids materialising duplicates before deduplication.

---

## Stage 4 — Page-load DB pressure

The notifications endpoint is hit on every page load for every student. With 50K students browsing actively, a busy minute can mean 100K reads/min landing on the primary — each running at minimum a count query and a list query.

### Strategies

#### 1. Cache hot reads in Redis

Cache `user_notification_summary.unread_count` and the latest 50 notification IDs per user. Both keyed by `user_id`.

- TTL of 60s **and** event-driven invalidation: on insert or read-toggle, the producer publishes an invalidation event; the cache layer purges the user's keys.
- Cache hit ratio for the badge query approaches 100% in steady state — data only changes when something happens.

**Tradeoff**: cache invalidation is hard. A missed invalidation means a stale badge for up to TTL. Acceptable for the *list* (the user can refresh), tighter for the *badge* — so we lean harder on event-driven invalidation there.

#### 2. Replace polling with push

Once a WebSocket connection is open (Stage 1), the client doesn't refetch on every page load — it has the live stream. The UI hydrates from a single initial fetch and updates in-place on each `notification.created` / `notification.updated`.

DB load drops to: one fetch per session, plus deltas (which never hit the read path — they come through Pub/Sub).

**Tradeoff**: the WebSocket gateway is a new component with its own scaling, sticky-session, and reconnection concerns. Connection count per node becomes the new operational metric.

#### 3. Read replicas

Route list queries to replicas; keep mark-as-read on the primary. Multiplies read throughput linearly with replica count.

**Tradeoff**: replication lag means a user who marks-read can still see the notification as unread for a few hundred ms after refresh. Mitigate with read-your-writes routing — pin that user to the primary for N seconds after a write.

#### 4. Materialized counter

The `user_notification_summary.unread_count` from Stage 2 turns the badge query from a `COUNT(*)` (potentially many index entries) into a `SELECT one row by PK`. Pair with the cache.

**Tradeoff**: every insert / read-toggle costs an extra `UPDATE`. Worth it: reads dominate by orders of magnitude.

#### 5. Coalesced writes

Marking-read happens often. Batch them: client buffers reads for ~500 ms and POSTs `mark-as-read` with an array of IDs. Cuts UPDATE QPS by an order of magnitude.

**Tradeoff**: read-state lags by up to the buffer window across a user's other devices.

### Recommended composite

- **Steady-state reads**: WebSocket push + Redis cache for unread count. DB barely touched.
- **First page load / reconnect**: Redis first, fall back to a read replica.
- **Writes**: primary, with materialized counter updated in-transaction.
- **Cold path**: client batches mark-read; server uses cursor pagination.

Net effect: the per-user "open the page" cost moves from "1 count + 1 list query against the primary" to "1 cache read" in the common case.

---

## Stage 5 — `notify_all` redesign

### Shortcomings of the original loop

```python
function notify_all(student_ids, message):
    for student_id in student_ids:
        send_email(student_id, message)
        save_to_db(student_id, message)
        push_to_app(student_id, message)
```

1. **Sequential.** 50K students × even 50 ms per email API call = ~40 minutes. The HR endpoint is blocked the whole time.
2. **Three sync calls per student.** Each is a remote dependency (email, DB, push). Any one slow call slows the whole iteration.
3. **No retry / DLQ.** When `send_email` failed for 200 students midway, those 200 are silently lost. There is no record they need a retry.
4. **Inconsistent state on partial failure.** Did `save_to_db` happen before or after the email? If the iteration crashes mid-loop, who got what?
5. **No idempotency.** Re-running the function re-sends to *everyone*, including students who already got the email.
6. **No backpressure / rate limiting.** If the email API rate-limits us we keep hammering it.
7. **Coupling.** A failure in any one channel takes down the whole notification.
8. **Crashes lose progress.** Process restart means starting over and double-sending to the first half.

### What now (immediate response to the 200 failures)

The current code doesn't even *know* which 200 IDs failed — that's the deeper problem. Step one is to make failures identifiable and replayable:

- Recover the failed IDs from logs (best-effort) so we can run a one-shot replay job through the new pipeline against just those IDs.
- Idempotency keys (one per `(notification_id, channel)`) prevent double-sending even if some of the 200 actually did make it through before the failure.

Long-term: the redesign below makes this kind of partial failure routine and recoverable instead of a fire drill.

### Redesign

```
HR clicks "Notify All"
        │
        ▼
+---------------+      same TXN     +-------------------+
| Broadcast API | ─────────────────▶ | broadcasts (DB)   |
|  (1 row write)|                   | + outbox row      |
+---------------+                   +-------------------+
                                              │
                                  outbox publisher (CDC or polling)
                                              │
                                              ▼
                                   +-----------------+
                                   |  Kafka topic    |
                                   |  broadcast.fanout│
                                   +-----------------+
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                    +------------------+             +------------------+
                    | fan-out worker   |  per batch  | per-channel jobs |
                    | (chunks of 1000) │───────────▶ │ email.send       │
                    | bulk insert      │             │ push.send        │
                    | notifications    │             +------------------+
                    +------------------+                      │
                                                              ▼
                                                   per-channel workers
                                                   (retry, backoff, DLQ)
```

Properties:

- **Durable hand-off** — broadcast row + outbox row are written in one DB transaction. Once the API returns 200 to HR, the broadcast is guaranteed to be processed eventually, even across crashes.
- **Per-channel queues** — email, push, and DB-fanout are independent topics. A broken email provider doesn't stop in-app notifications.
- **Idempotency keys** — `notification_id + channel` is the dedupe key. Any retry is safe.
- **Bounded fan-out batches** — chunks of ~1000 keep DB inserts and worker memory predictable.
- **Backpressure** — workers consume at the rate the email API allows; nothing piles up in app memory.
- **Observability** — `broadcasts.status`, per-channel delivery state on each notification, plus DLQ queues with a manual replay tool.

### Should DB save and email send be atomic?

**No.** They cross a system boundary; a 2PC across a database and an SMTP/SES API is fragile and rarely supported.

The right pattern is the **transactional outbox**:

1. Inside the DB transaction: insert the `notifications` row(s) **and** an `outbox` row capturing "notify by email and push".
2. Commit. The user-visible state ("a notification exists in my inbox") is now durable.
3. A separate publisher process tails the outbox table (CDC, or simple polling of `WHERE published_at IS NULL`) and publishes to Kafka with at-least-once semantics — duplicate publishes are caught by the idempotency key on the consumer.
4. Email / push workers consume from Kafka, perform their I/O, and update `notifications.email_status` / `push_status`.

Result: **the user always sees the notification in the app** (which is the contract), and **email / push are best-effort with retries and visible failure state**. If the email provider is down for 3 hours, in-app notifications still arrive on time and emails catch up afterward.

The other ordering — send email first, then write DB — risks "the email said it sent, but the notification doesn't show up in the app", which is more confusing for the user than a delayed email.

### Revised pseudocode

```python
# Synchronous HTTP handler — completes in tens of ms
def notify_all(student_ids, message, type):
    broadcast_id = uuid()
    with db.transaction():
        save_broadcast(broadcast_id, type, message, len(student_ids))
        write_outbox({
            "kind":         "broadcast.fanout",
            "broadcast_id": broadcast_id,
            "student_ids":  student_ids,   # or a cohort filter for very large lists
            "type":         type,
            "message":      message,
        })
    return { "broadcast_id": broadcast_id, "status": "queued" }

# Async fan-out worker — consumes broadcast.fanout
def handle_broadcast_fanout(event):
    for batch in chunks(event.student_ids, 1000):
        # 1. Persist notification rows in one statement
        notif_ids = bulk_insert_notifications(
            recipients=batch,
            type=event.type,
            message=event.message,
            broadcast_id=event.broadcast_id,
        )
        # 2. Publish per-channel jobs — idempotency key = notif_id + channel
        for nid, sid in zip(notif_ids, batch):
            publish("email.send",
                    key=f"{nid}:email",
                    payload={ "notification_id": nid, "student_id": sid, "message": event.message })
            publish("push.send",
                    key=f"{nid}:push",
                    payload={ "notification_id": nid, "student_id": sid, "message": event.message })

# Email worker — idempotent, retried, DLQ on permanent failure
def handle_email(job):
    if email_already_sent(job.notification_id):
        return ack()
    try:
        send_email(job.student_id, job.message)
        mark_sent(job.notification_id, channel="email")
    except RetryableError as e:
        # exponential backoff, capped at e.g. 6 retries / 1 hour
        nack_with_backoff(e)
    except PermanentError as e:
        mark_failed(job.notification_id, channel="email", reason=str(e))
        send_to_dlq(job)
```

Key shifts vs the original loop:

| Original | Redesign |
|---|---|
| Sequential | Parallel workers, bounded by per-channel rate limits |
| No retry | Per-channel exponential backoff + DLQ |
| Lost-on-crash | Durable outbox + at-least-once delivery |
| Re-runs duplicate | Idempotency keys per `(notif, channel)` |
| One slow API blocks all | Per-channel queues isolate failures |
| No visibility | `broadcasts.status` + per-channel delivery state |

---

## Stage 6 — Priority Inbox

> Code lives in [`notification_app_be/`](./notification_app_be/). Run with `npm start` (after populating `secrets.local.json`) or `npm run example` for the synthetic-data smoke test. Output screenshots are in `notification_app_be/screenshots/`.

### Priority formula

```
score(n) = TYPE_WEIGHT[n.Type] * 1e15 + epochMs(n.Timestamp)

TYPE_WEIGHT = { Placement: 3, Result: 2, Event: 1 }
```

The multiplier `1e15` is larger than any plausible epoch-ms timestamp, so type weight strictly dominates and timestamp acts as a pure tiebreaker. Every Placement outranks every Result regardless of age; within the same type, newer wins. This matches the natural reading of "weight (placement > result > event) and recency."

An alternative softer formula — `weight * exp(-age/halfLife)` — lets a *very* fresh Event outrank a year-old Placement. That's a reasonable product call too, but the strict-tuple version aligns more directly with the way the prompt phrases the rule.

### Algorithm: bounded min-heap

A naive `notifications.sort().slice(0, n)` is `O(N log N)` time and `O(N)` memory. That's fine for one shot, but the prompt explicitly asks how to maintain top-N efficiently as new notifications stream in. For that, sort+slice has to redo `O(N log N)` work on every arrival.

A **bounded min-heap of size n** does it in `O(N log n)` time and `O(n)` memory for the initial pass, plus `O(log n)` per new arrival:

- The heap holds at most `n` items. The smallest score sits at the root.
- New arrival comes in. Compare to the root.
- If heap has fewer than `n` items → push it.
- Else if `newScore > rootScore` → replace root, sift down.
- Else → discard. The expensive case is just one comparison.

For `n = 10` that's ~3.3 ops per item regardless of how big the firehose is. The `ingest()` method also returns a boolean — `true` if the item entered the top-N, `false` if it was discarded — which is the cheapest possible "did anything change, do I need to re-render the UI?" signal.

### Code

`notification_app_be/src/priority-inbox.js` exposes:

- `priorityScore(notification)` — pure function, returns the composite score.
- `BoundedMinHeap` — generic capacity-bounded min-heap (`consider`, `peek`, `toSortedDesc`).
- `topNNotifications(notifications, n)` — single-pass top-N over a static list.
- `PriorityInbox` — class wrapper for the live-stream case (`ingest`, `ingestMany`, `top`).

`src/index.js` fetches `/evaluation-service/notifications` via the shared authed client (which reuses the logging-middleware's auth + token-refresh), runs `topNNotifications`, and prints a ranked table. `examples/synthetic.js` runs the same logic against fixed in-memory data so the ordering can be verified without touching the network.

### Maintaining top-N as new notifications arrive

In a long-running service, wrap the heap in `PriorityInbox`:

```js
const inbox = new PriorityInbox(10);
inbox.ingestMany(await fetchNotifications());          // initial seed

ws.on('message', (raw) => {
  const event = JSON.parse(raw);
  if (event.type === 'notification.created') {
    const changed = inbox.ingest(event.data);
    if (changed) reRenderUI(inbox.top());              // only re-render when the heap actually shifts
  }
});
```

Each arrival is `O(log 10)` ≈ constant; the UI only re-renders when the top-N actually changes. Memory is bounded at exactly `n` items regardless of how many notifications the user has accumulated.
