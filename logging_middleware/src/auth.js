const fs = require('fs');
const path = require('path');

const EVAL_BASE = process.env.EVAL_BASE_URL || 'http://20.207.122.201/evaluation-service';

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'secrets.local.json')) ||
        fs.existsSync(path.join(dir, 'secrets.local.json.example'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function loadSecretsFile() {
  const root = findRepoRoot(process.cwd());
  const p = path.join(root, 'secrets.local.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return {};
  }
}

function loadCredentials() {
  const file = loadSecretsFile();
  return {
    email: process.env.EVAL_EMAIL || file.email,
    name: process.env.EVAL_NAME || file.name,
    mobileNo: process.env.EVAL_MOBILE || file.mobileNo,
    githubUsername: process.env.EVAL_GITHUB || file.githubUsername,
    rollNo: process.env.EVAL_ROLLNO || file.rollNo,
    accessCode: process.env.EVAL_ACCESS_CODE || file.accessCode,
    clientID: process.env.EVAL_CLIENT_ID || file.clientID,
    clientSecret: process.env.EVAL_CLIENT_SECRET || file.clientSecret,
    accessToken: process.env.EVAL_ACCESS_TOKEN || file.accessToken,
  };
}

let tokenCache = { token: null, expiresAt: 0 };

async function fetchNewToken() {
  const c = loadCredentials();
  const required = ['email', 'name', 'mobileNo', 'githubUsername', 'rollNo', 'accessCode', 'clientID', 'clientSecret'];
  const missing = required.filter((k) => !c[k]);
  if (missing.length) {
    throw new Error(
      `cannot fetch token — missing credentials: ${missing.join(', ')}. ` +
      `Populate secrets.local.json or set the corresponding EVAL_* env vars.`,
    );
  }

  const res = await fetch(`${EVAL_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: c.email,
      name: c.name,
      mobileNo: c.mobileNo,
      githubUsername: c.githubUsername,
      rollNo: c.rollNo,
      accessCode: c.accessCode,
      clientID: c.clientID,
      clientSecret: c.clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`auth failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const ttlSec = Number(data.expires_in) || 3600;
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (ttlSec - 60) * 1000,
  };
  return tokenCache.token;
}

async function getAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const cached = loadCredentials().accessToken;
  if (!forceRefresh && cached && !tokenCache.token) {
    tokenCache = { token: cached, expiresAt: Date.now() + 60 * 1000 };
    return cached;
  }
  return fetchNewToken();
}

function invalidateToken() {
  tokenCache = { token: null, expiresAt: 0 };
}

module.exports = { getAccessToken, invalidateToken, EVAL_BASE };
