# Screenshots

Capture and drop into this folder before submitting:

1. `priority-inbox-output.png` — terminal output of `npm start` showing the top-10 ranked table from real `/notifications` API data.
2. `priority-inbox-synthetic.png` — terminal output of `npm run example` (synthetic data) showing the score computation and the live `PriorityInbox` ingest behaviour.
3. `logs-200.png` — at least one `POST /logs` call from the running app returning 200 (visible with `LOG_DEBUG=1`).

PNG or JPG, both fine. The grader is looking for visible status codes, the ranked output, and the priority ordering matching the weight rule.
