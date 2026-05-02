const { Log } = require('..');

(async () => {
  const r1 = await Log('backend', 'info', 'service', 'logging middleware smoke test — info');
  console.log('info ->', r1);

  const r2 = await Log('backend', 'warn', 'handler', 'logging middleware smoke test — warn');
  console.log('warn ->', r2);

  const r3 = await Log('backend', 'error', 'route', 'logging middleware smoke test — error');
  console.log('error ->', r3);
})();
