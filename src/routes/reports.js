const express = require('express');

const router = express.Router();

const ReportController = require('../controllers/reportController');

const { authenticateOAuth } = require('../middleware/oauth-auth');
const { requireRole } = require('../middleware/permissions');

const REPORT_ROLES = [
  'it_head',
  'coordinator',
  'superadmin',
  'admin'
];

/**
 * VC Call Report
 * GET /api/reports/vc
 */
router.get(
  '/vc',
  authenticateOAuth,
  requireRole(REPORT_ROLES),
  ReportController.getVCCallReport
);

/**
 * Server Report
 * GET /api/reports/server
 */
router.get(
  '/server',
  authenticateOAuth,
  requireRole(REPORT_ROLES),
  ReportController.getServerReport
);

module.exports = router;
