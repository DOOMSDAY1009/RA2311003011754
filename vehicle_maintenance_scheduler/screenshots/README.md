# Screenshots

Capture and drop into this folder before submitting:

1. `register-200.png` — Postman/curl response for `POST /register` (mask any client secret values you don't want to publish; the `clientID` is fine to leave visible).
2. `auth-200.png` — `POST /auth` returning the access token.
3. `schedule-all.png` — `GET http://localhost:3000/schedule` showing the full multi-depot result.
4. `schedule-one.png` — `GET http://localhost:3000/schedule/1` (any depot id you have).
5. `logs-200.png` — at least one `POST /logs` call from the running service returning 200 (visible in the terminal with `LOG_DEBUG=1`, or captured by tailing the `/logs` endpoint with a network proxy).

PNG or JPG, both fine. The grader is looking for visible status codes and response bodies.
