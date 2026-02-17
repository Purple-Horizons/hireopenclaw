const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 1;

function log(level, module, message, data = {}) {
  if (LOG_LEVELS[level] < LEVEL) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    module,
    message,
    ...data
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

module.exports = {
  debug: (mod, msg, data) => log('debug', mod, msg, data),
  info: (mod, msg, data) => log('info', mod, msg, data),
  warn: (mod, msg, data) => log('warn', mod, msg, data),
  error: (mod, msg, data) => log('error', mod, msg, data),
};
