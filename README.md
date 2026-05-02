# Evaluation Submission

Backend track submission containing:

- `logging_middleware/` — reusable Node package exposing `Log(stack, level, package, message)`, posts to the evaluation `/logs` endpoint with Bearer auth and automatic token refresh.
- `vehicle_maintenance_scheduler/` — Express microservice that fetches depots + vehicles from the evaluation APIs and returns the optimal subset of tasks (0/1 knapsack) per depot.
- `notification_app_be/` — placeholder; awaiting problem spec.
- `notification_system_design.md` — placeholder; awaiting design question.

## Quickstart

```bash
# 1. Install deps for each app
cd logging_middleware && npm install && cd ..
cd vehicle_maintenance_scheduler && npm install && cd ..

# 2. Register against the evaluation service (one-shot, do this carefully):
#    POST http://20.207.122.201/evaluation-service/register
#    See secrets.local.json.example for the body shape.
#    Save the returned clientID + clientSecret into secrets.local.json (gitignored).

# 3. Auth to get an access_token:
#    POST http://20.207.122.201/evaluation-service/auth (same body + clientID/clientSecret)

# 4. Drop secrets.local.json at the repo root. Both the middleware and the
#    scheduler will read credentials from there (or from env vars).

# 5. Run the scheduler:
cd vehicle_maintenance_scheduler && npm start
# GET http://localhost:3000/schedule
```

## Repo layout

```
.
├── logging_middleware/
│   └── src/{index.js, auth.js, validate.js}
├── vehicle_maintenance_scheduler/
│   ├── src/{server.js, routes/, services/, lib/}
│   └── screenshots/
├── notification_app_be/        (placeholder)
├── notification_system_design.md  (placeholder)
├── secrets.local.json.example
└── .gitignore
```

## Credentials handling

`secrets.local.json` lives at the repo root, is gitignored, and is the single source of truth for:

- registration fields (email, name, mobileNo, githubUsername, rollNo, accessCode)
- `clientID` + `clientSecret` (after registration)
- optional cached `access_token` (the middleware refreshes when expired)

Both the logging middleware and the scheduler resolve secrets in this order:
1. Environment variables (`EVAL_CLIENT_ID`, `EVAL_CLIENT_SECRET`, `EVAL_ACCESS_TOKEN`, etc.)
2. `secrets.local.json` at repo root
