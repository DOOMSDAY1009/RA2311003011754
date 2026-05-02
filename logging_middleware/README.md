# logging_middleware

Reusable Node package that exposes a single function:

```js
Log(stack, level, package, message)
```

It POSTs `{ stack, level, package, message }` to `http://20.207.122.201/evaluation-service/logs` with `Authorization: Bearer <access_token>` and handles token refresh on 401/403.

## Allowed values (lowercase, validated)

| Field | Backend | Frontend |
|---|---|---|
| `stack` | `backend` | `frontend` |
| `level` | `debug`, `info`, `warn`, `error`, `fatal` | same |
| `package` | `handler`, `repository`, `route`, `service`, `auth`, `config`, `middleware`, `utils` | `api`, `component`, `hook`, `page`, `state`, `style` |

Invalid arguments are rejected without making a network call.

## Auth flow

The middleware reads credentials from `secrets.local.json` at the repo root (or the equivalent `EVAL_*` env vars). On the first `Log()` call it POSTs to `/auth` to obtain an `access_token`, caches it (with a 60s safety margin before `expires_in`), and reuses it. If a log call comes back `401`/`403`, the token is invalidated and re-fetched once before retrying the log request. Failures are returned as `{ ok: false, error }` rather than thrown — logging never crashes the caller.

## Usage

```js
const { Log } = require('logging-middleware'); // or relative path inside this repo

await Log('backend', 'info',  'service', 'depots fetched');
await Log('backend', 'warn',  'service', 'vehicles request slow (1.2s)');
await Log('backend', 'error', 'route',   'GET /schedule failed: depot id 7 not found');
await Log('backend', 'fatal', 'service', 'auth credentials missing — cannot continue');
```

## Smoke test

After populating `secrets.local.json`:

```bash
LOG_DEBUG=1 node examples/basic.js
```

Each call returns `{ ok: true, status: 200, data: { ... } }` on success.

## Files

- `src/index.js` — `Log()` entrypoint, retry-on-401, error handling
- `src/auth.js` — credential resolution (env > `secrets.local.json`), token cache, `/auth` call
- `src/validate.js` — strict validation of `stack` / `level` / `package`
- `examples/basic.js` — single-call smoke test
