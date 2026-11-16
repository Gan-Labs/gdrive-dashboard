'use strict';
const personal = require('../lib/drive-api.cjs');
module.exports = async (req, res) => {
  if (process.env.DASHBOARD_MODE === 'shared') return require('../lib/shared-runtime.cjs').runtime().handler(req, res);
  return personal(req, res);
};
// Keep the pure, injectable Drive API available to local tests and adapters.
Object.assign(module.exports, { createHandler: personal.createHandler, parseCsv: personal.parseCsv, MAX_IMAGE: personal.MAX_IMAGE });
