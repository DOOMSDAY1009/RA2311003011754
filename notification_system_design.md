# Notification System — Design

> **Status: placeholder — awaiting the specific design question / scale parameters.**
>
> The track rubric requires this file to contain the architecture and reasoning for the notification system question. Replace the body below with the design once the problem statement is available.

---

## Suggested structure (fill in once the spec lands)

### 1. Problem framing

- What kinds of notifications? (transactional, marketing, system alerts)
- Channels: in-app, email, SMS, push, webhook?
- Scale: messages/day, peak QPS, fan-out per event
- Latency budget: p50 / p99 from event to delivery
- Delivery guarantees: at-least-once, at-most-once, exactly-once?
- Ordering: per-user FIFO required? Cross-channel order?

### 2. High-level architecture

```
+----------+     +----------------+     +----------+     +-----------+
| Producer | --> | Notification   | --> | Channel  | --> | Provider  |
| services |     | API + Router   |     | workers  |     | (SES/FCM) |
+----------+     +----------------+     +----------+     +-----------+
                        |                     ^
                        v                     |
                  +-----------+         +-----------+
                  | User Pref |         |  Retry /  |
                  |  Service  |         |  DLQ      |
                  +-----------+         +-----------+
```

### 3. Component breakdown

- **API gateway / producer SDK** — input validation, idempotency keys
- **Router** — pulls user preferences, decides channels, fans out
- **Per-channel queue** (Kafka topic / SQS) — backpressure, isolation
- **Channel workers** — render template, call provider, write delivery receipt
- **Retry policy** — exponential backoff, capped, then DLQ
- **Observability** — delivery success rate per channel, latency histograms

### 4. Data model

- `notifications` (id, user_id, type, payload, created_at)
- `deliveries` (notification_id, channel, status, attempts, last_error)
- `user_preferences` (user_id, channel, opted_in, quiet_hours)
- `templates` (key, channel, locale, body)

### 5. Trade-offs to discuss

- Push-based fan-out vs pull-based digest
- Synchronous send (lower latency, harder backpressure) vs queue-based (resilient, higher tail latency)
- Storing full notification payload vs reference + lazy fetch
- Idempotency window length vs storage cost
- Per-user rate limiting and "quiet hours" logic

### 6. Failure modes + mitigations

- Provider outage — circuit breaker + fall back to alternate provider where possible, DLQ otherwise
- Hot-key user (e.g. 1M followers) — sharded fan-out workers, fan-out tree
- Duplicate events — idempotency key on producer + dedupe table
- Stuck queues — DLQ alarm + replay tool
