'use strict';
module.exports = (req, res) => {
  if (process.env.DASHBOARD_MODE !== 'shared') { res.statusCode = 404; res.end(); return; }
  return require('../lib/shared-runtime.cjs').runtime().fileHandler(req, res);
};
