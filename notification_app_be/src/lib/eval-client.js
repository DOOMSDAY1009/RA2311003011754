const { getAccessToken, invalidateToken, EVAL_BASE } = require('logging-middleware/src/auth');

async function authedGet(pathSuffix) {
  const url = `${EVAL_BASE}${pathSuffix}`;
  let token = await getAccessToken();
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401 || res.status === 403) {
    invalidateToken();
    token = await getAccessToken({ forceRefresh: true });
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${pathSuffix} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = { authedGet };
