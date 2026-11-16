'use strict';
const { createSharedDashboard } = require('./shared.cjs');
const { privateStore } = require('./private-store.cjs');
const { ownerDrive } = require('./owner-drive.cjs');
let instance, queue;
function queueClient() {
  if (!queue) { const { QueueClient } = require('@vercel/queue'); queue = new QueueClient(); }
  return queue;
}
function runtime() {
  if (!instance) {
    const rootId = process.env.GOOGLE_DRIVE_ROOT_ID || '1qXAMcNrZuqk4wlGbqZlmHydQ-cSthbIV';
    instance = createSharedDashboard({ rootId, password: process.env.DASHBOARD_PASSWORD,
      store: privateStore(), drive: ownerDrive(rootId),
      enqueue: message => queueClient().send('drive-index', message, { retentionSeconds: 86400 }) });
  }
  return instance;
}
module.exports = { runtime, queueClient };
