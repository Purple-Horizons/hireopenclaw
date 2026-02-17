/**
 * ETag/If-None-Match caching utility
 * Use withETag(req, res, data) instead of res.json(data) for cacheable responses.
 */
const crypto = require('crypto');

function withETag(req, res, data) {
  const etag = `"${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')}"`;
  res.setHeader('ETag', etag);

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  return res.json(data);
}

module.exports = { withETag };
