/**
 * Shared in-memory token store (magic links + sessions)
 * In production, use Redis or DynamoDB
 */
const tokenStore = new Map();
module.exports = tokenStore;
