'use strict';
// Registered queue consumers are private endpoints in Vercel.
let callback;
module.exports = (req, res) => {
  if (!callback) {
    const { queueClient, runtime } = require('../lib/shared-runtime.cjs');
    callback = queueClient().handleNodeCallback(async (message, metadata) => {
      // A deliberate switch back to personal mode cancels queued shared work.
      if (process.env.DASHBOARD_MODE !== 'shared') return;
      if (!message || typeof message.jobId !== 'string') return;
      try { await runtime().processJob(message); }
      catch (error) {
        // Another worker or an explicit Resume owns the newer checkpoint.
        if (error.status === 409) return;
        if (metadata.deliveryCount >= 5) { await runtime().pauseJob(message.jobId, message.run); return; }
        throw new Error('Shared indexing failed. Check backend Drive access and private storage; the saved checkpoint will be retried.');
      }
    }, { retry: (_, metadata) => ({ afterSeconds: Math.min(120, 5 * 2 ** metadata.deliveryCount) }) });
  }
  return callback(req, res);
};
