/**
 * Unit tests for instance-level secrets (TASK-151)
 * Tests the cascading merge logic: platform → client → instance
 */

describe('Instance Secrets - Cascading Merge', () => {
  // Simulate the merge logic from instance-secrets.js
  function mergeSecrets(platform, client, instance) {
    const merged = {};
    for (const s of platform) merged[s.key] = s.value;
    for (const s of client) merged[s.key] = s.value;
    for (const s of instance) merged[s.key] = s.value;
    return merged;
  }

  test('instance overrides client overrides platform', () => {
    const platform = [{ key: 'FAL_KEY', value: 'platform_fal' }];
    const client = [{ key: 'FAL_KEY', value: 'client_fal' }];
    const instance = [{ key: 'FAL_KEY', value: 'instance_fal' }];

    const result = mergeSecrets(platform, client, instance);
    expect(result.FAL_KEY).toBe('instance_fal');
  });

  test('client overrides platform when no instance', () => {
    const platform = [{ key: 'FAL_KEY', value: 'platform_fal' }];
    const client = [{ key: 'FAL_KEY', value: 'client_fal' }];
    const instance = [];

    const result = mergeSecrets(platform, client, instance);
    expect(result.FAL_KEY).toBe('client_fal');
  });

  test('platform used when no client or instance', () => {
    const platform = [{ key: 'FAL_KEY', value: 'platform_fal' }];
    const result = mergeSecrets(platform, [], []);
    expect(result.FAL_KEY).toBe('platform_fal');
  });

  test('different keys merge without conflict', () => {
    const platform = [{ key: 'FAL_KEY', value: 'fal_123' }];
    const client = [{ key: 'METRICOOL_TOKEN', value: 'mc_456' }];
    const instance = [{ key: 'TELEGRAM_BOT_TOKEN', value: 'tg_789' }];

    const result = mergeSecrets(platform, client, instance);
    expect(result.FAL_KEY).toBe('fal_123');
    expect(result.METRICOOL_TOKEN).toBe('mc_456');
    expect(result.TELEGRAM_BOT_TOKEN).toBe('tg_789');
  });

  test('empty at all levels returns empty', () => {
    expect(mergeSecrets([], [], [])).toEqual({});
  });

  test('instance-only key not present at other levels', () => {
    const result = mergeSecrets([], [], [{ key: 'TELEGRAM_BOT_TOKEN', value: 'tg_unique' }]);
    expect(result.TELEGRAM_BOT_TOKEN).toBe('tg_unique');
    expect(Object.keys(result)).toHaveLength(1);
  });
});

describe('Instance Secrets - Tenant ID Validation', () => {
  function isValidTenantId(id) {
    return /^[a-zA-Z0-9_-]+$/.test(id);
  }

  test('valid tenant IDs accepted', () => {
    expect(isValidTenantId('test-bot-001')).toBe(true);
    expect(isValidTenantId('my_bot_123')).toBe(true);
    expect(isValidTenantId('SimpleBot')).toBe(true);
    expect(isValidTenantId('a')).toBe(true);
  });

  test('injection attempts rejected', () => {
    expect(isValidTenantId('foo; rm -rf /')).toBe(false);
    expect(isValidTenantId('bot$(whoami)')).toBe(false);
    expect(isValidTenantId('bot`id`')).toBe(false);
    expect(isValidTenantId('bot|cat /etc/passwd')).toBe(false);
    expect(isValidTenantId('../../../etc')).toBe(false);
    expect(isValidTenantId('')).toBe(false);
    expect(isValidTenantId('bot name with spaces')).toBe(false);
  });
});

describe('Instance Secrets - Channel Token Keys', () => {
  const CHANNEL_TOKEN_KEYS = {
    telegram: 'TELEGRAM_BOT_TOKEN',
    discord: 'DISCORD_BOT_TOKEN',
    whatsapp: 'WHATSAPP_TOKEN',
    signal: 'SIGNAL_NUMBER'
  };

  test('each channel has a unique token key', () => {
    const keys = Object.values(CHANNEL_TOKEN_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('telegram token key is TELEGRAM_BOT_TOKEN', () => {
    expect(CHANNEL_TOKEN_KEYS.telegram).toBe('TELEGRAM_BOT_TOKEN');
  });

  test('two bots can have different telegram tokens', () => {
    const bot1Secrets = [{ key: 'TELEGRAM_BOT_TOKEN', value: 'token_a' }];
    const bot2Secrets = [{ key: 'TELEGRAM_BOT_TOKEN', value: 'token_b' }];
    
    // Merge for bot1 (platform + client + instance)
    const bot1 = {};
    for (const s of bot1Secrets) bot1[s.key] = s.value;
    
    const bot2 = {};
    for (const s of bot2Secrets) bot2[s.key] = s.value;
    
    expect(bot1.TELEGRAM_BOT_TOKEN).not.toBe(bot2.TELEGRAM_BOT_TOKEN);
  });
});
