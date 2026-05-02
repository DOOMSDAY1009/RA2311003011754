const { validate } = require('./validate');
const { getAccessToken, invalidateToken, EVAL_BASE } = require('./auth');

const LOGS_URL = `${EVAL_BASE}/logs`;

async function postLog(token, payload) {
  return fetch(LOGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

async function Log(stack, level, pkg, message) {
  try {
    validate({ stack, level, pkg, message });
  } catch (err) {
    if (process.env.LOG_DEBUG === '1') {
      console.error(`[Log] validation error: ${err.message}`);
    }
    return { ok: false, error: err.message };
  }

  const payload = { stack, level, package: pkg, message };

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    if (process.env.LOG_DEBUG === '1') {
      console.error(`[Log] auth error: ${err.message}`);
    }
    return { ok: false, error: err.message };
  }

  try {
    let res = await postLog(token, payload);

    if (res.status === 401 || res.status === 403) {
      invalidateToken();
      try {
        token = await getAccessToken({ forceRefresh: true });
      } catch (err) {
        return { ok: false, error: `refresh failed: ${err.message}` };
      }
      res = await postLog(token, payload);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (process.env.LOG_DEBUG === '1') {
        console.error(`[Log] ${res.status} ${body}`);
      }
      return { ok: false, status: res.status, error: body };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, data };
  } catch (err) {
    if (process.env.LOG_DEBUG === '1') {
      console.error(`[Log] network error: ${err.message}`);
    }
    return { ok: false, error: err.message };
  }
}

module.exports = { Log };
