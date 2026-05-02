const STACKS = new Set(['backend', 'frontend']);
const LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const PACKAGES_BACKEND = new Set([
  'handler', 'repository', 'route', 'service',
  'auth', 'config', 'middleware', 'utils',
]);
const PACKAGES_FRONTEND = new Set([
  'api', 'component', 'hook', 'page', 'state', 'style',
]);

function validate({ stack, level, pkg, message }) {
  if (!STACKS.has(stack)) {
    throw new Error(`invalid stack: "${stack}" (allowed: ${[...STACKS].join(', ')})`);
  }
  if (!LEVELS.has(level)) {
    throw new Error(`invalid level: "${level}" (allowed: ${[...LEVELS].join(', ')})`);
  }
  const allowedPkgs = stack === 'backend' ? PACKAGES_BACKEND : PACKAGES_FRONTEND;
  if (!allowedPkgs.has(pkg)) {
    throw new Error(
      `invalid package "${pkg}" for stack "${stack}" (allowed: ${[...allowedPkgs].join(', ')})`,
    );
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new Error('message must be a non-empty string');
  }
}

module.exports = { validate, STACKS, LEVELS, PACKAGES_BACKEND, PACKAGES_FRONTEND };
