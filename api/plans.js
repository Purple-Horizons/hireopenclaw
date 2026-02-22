/**
 * GET /api/plans — Public plans endpoint (single source of truth)
 * Returns plan data for dynamic pricing pages.
 */
const plans = require('../api-local/data/plans.json');

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(plans);
}
