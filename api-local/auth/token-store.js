/**
 * Session & token store backed by DynamoDB (clawops-auth-tokens)
 * Falls back to in-memory Map for magic link tokens (short-lived, single-use)
 * Sessions persist across portal restarts
 */

const { PutItemCommand, GetItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { client: dynamodb } = require('../util/dynamodb.js');

const TABLE = 'clawops-auth-tokens';
const memoryStore = new Map();

const store = {
  set(token, data) {
    memoryStore.set(token, data);
    // Persist sessions to DynamoDB (not short-lived magic link tokens)
    if (data.type === 'session') {
      dynamodb.send(new PutItemCommand({
        TableName: TABLE,
        Item: {
          token: { S: token },
          email: { S: data.email },
          type: { S: 'session' },
          expiresAt: { N: String(data.expiresAt) },
        }
      })).catch(err => console.error('[TokenStore] DynamoDB put failed:', err.message));
    }
  },

  async get(token) {
    // Check memory first
    if (memoryStore.has(token)) {
      return memoryStore.get(token);
    }
    // Fall back to DynamoDB for sessions
    try {
      const result = await dynamodb.send(new GetItemCommand({
        TableName: TABLE,
        Key: { token: { S: token } },
      }));
      if (result.Item) {
        const data = {
          email: result.Item.email.S,
          type: result.Item.type.S,
          expiresAt: Number(result.Item.expiresAt.N),
        };
        // Cache in memory
        memoryStore.set(token, data);
        return data;
      }
    } catch (err) {
      console.error('[TokenStore] DynamoDB get failed:', err.message);
    }
    return undefined;
  },

  delete(token) {
    memoryStore.delete(token);
    dynamodb.send(new DeleteItemCommand({
      TableName: TABLE,
      Key: { token: { S: token } },
    })).catch(err => console.error('[TokenStore] DynamoDB delete failed:', err.message));
  },

  has(token) {
    return memoryStore.has(token);
  },

  entries() {
    return memoryStore.entries();
  },

  // Test helper — clears in-memory store only
  clear() {
    memoryStore.clear();
  },
};

module.exports = store;
