const { execFileSync } = require('child_process');

async function dockerExec(args, options = {}) {
  const maxRetries = options.retries || 3;
  const timeout = options.timeout || 15000;
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return execFileSync('docker', args, {
        encoding: 'utf8',
        timeout,
        ...options
      });
    } catch (err) {
      lastError = err;
      if (i < maxRetries - 1) {
        console.warn(`[Docker] Retry ${i + 1}/${maxRetries} for: docker ${args.join(' ')}`);
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastError;
}

module.exports = { dockerExec };
