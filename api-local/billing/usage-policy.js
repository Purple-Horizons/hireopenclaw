/**
 * POST /api/billing/usage-policy
 * Update how over-limit usage is handled.
 */

const { requireAuth } = require('../auth/middleware.js');
const { updateTeamBillingByEmail } = require('./team-billing.js');

const MODES = new Set(['notify_only', 'hard_cap', 'metered']);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const email = await requireAuth(req, res);
    if (!email) return;

    const mode = String(req.body?.mode || '').trim().toLowerCase();
    if (!MODES.has(mode)) {
      return res.status(400).json({
        error: 'Invalid usage policy mode',
        allowed: Array.from(MODES),
      });
    }

    const team = await updateTeamBillingByEmail(email, {
      usagePolicy: {
        mode,
        updatedAt: new Date().toISOString(),
      },
    });

    return res.status(200).json({
      ok: true,
      usagePolicy: team?.usagePolicy || { mode },
    });
  } catch (error) {
    console.error('Update usage policy error:', error);
    return res.status(500).json({ error: 'Failed to update usage policy' });
  }
};
