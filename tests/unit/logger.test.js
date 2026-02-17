describe('logger', () => {
  let logger;
  let consoleSpy;

  beforeEach(() => {
    // Reset module to pick up env changes
    jest.resetModules();
    process.env.LOG_LEVEL = 'debug';
    logger = require('../../api-local/util/logger');
  });

  afterEach(() => {
    if (consoleSpy) consoleSpy.mockRestore();
    delete process.env.LOG_LEVEL;
  });

  test('outputs valid JSON', () => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test-mod', 'hello');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed).toBeDefined();
  });

  test('includes required fields', () => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('mymod', 'test message');
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.time).toBeDefined();
    expect(parsed.level).toBe('info');
    expect(parsed.module).toBe('mymod');
    expect(parsed.message).toBe('test message');
  });

  test('respects log levels - info suppresses debug', () => {
    jest.resetModules();
    process.env.LOG_LEVEL = 'info';
    const infoLogger = require('../../api-local/util/logger');
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    infoLogger.debug('mod', 'debug msg');
    expect(consoleSpy).not.toHaveBeenCalled();
    infoLogger.info('mod', 'info msg');
    expect(consoleSpy).toHaveBeenCalled();
  });

  test('error uses console.error', () => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('mod', 'err msg');
    expect(consoleSpy).toHaveBeenCalled();
  });

  test('warn uses console.warn', () => {
    consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('mod', 'warn msg');
    expect(consoleSpy).toHaveBeenCalled();
  });

  test('includes extra data fields', () => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('mod', 'msg', { userId: '123' });
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.userId).toBe('123');
  });
});
