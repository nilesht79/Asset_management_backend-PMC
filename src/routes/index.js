const express = require('express');
const { apiLimiter } = require('../middleware/rate-limit');
const { httpLogger, securityLogger, performanceLogger } = require('../middleware/logging');
const { corsMiddleware } = require('../middleware/cors');

// Import route modules
const authRoutes = require('./auth');
const oauthRoutes = require('./oauth');
const userRoutes = require('./users');
const departmentRoutes = require('./departments');
const boardRoutes = require('./boards');
const masterRoutes = require('./masters');
const assetRoutes = require('./assets');
const assetMovementRoutes = require('./asset-movements');
const standbyRoutes = require('./standby');
const dashboardRoutes = require('./dashboard');
const adminRoutes = require('./admin');
const ticketRoutes = require('./tickets');
const jobRoutes = require('./jobs');
const requisitionRoutes = require('./requisitions');
const deliveryTicketRoutes = require('./delivery-tickets');
const reconciliationRoutes = require('./reconciliations');
const systemConfigRoutes = require('./settings/system-config');
const companySettingsRoutes = require('./settings/company-settings');
const emailSettingsRoutes = require('./emailSettings');
const smsSettingsRoutes = require('./smsSettings');
const consumableRoutes = require('./consumables');
const consumableRequestRoutes = require('./consumables/requests');
const licenseRoutes = require('./licenses');
const repairHistoryRoutes = require('./repair-history');
const faultAnalysisRoutes = require('./fault-analysis');
const slaRoutes = require('./sla');
const serviceReportRoutes = require('./serviceReport');
const assetJobReportRoutes = require('./asset-job-reports');
const reportRoutes = require('./reports');
const gatePassRoutes = require('./gate-passes');
const notificationRoutes = require('./notifications');
const auditLogRoutes = require('./audit-logs');
const backupRoutes = require('./backups');

const router = express.Router();

// Apply common middleware to all routes
router.use(corsMiddleware);
router.use(httpLogger);
router.use(securityLogger);
router.use(performanceLogger);
// router.use(apiLimiter);

// Health check endpoint (before rate limiting)
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: 'connected',
      redis: 'connected',
      api: 'running'
    }
  });
});

// API Documentation info
router.get('/', (req, res) => {
  res.status(200).json({
    name: 'Unified ITSM Platform API',
    version: '1.0.0',
    description: 'RESTful API for Unified ITSM Platform',
    endpoints: {
      auth: '/auth',
      oauth: '/oauth',
      users: '/users',
      departments: '/departments',
      boards: '/boards',
      masters: '/masters',
      assets: '/assets',
      assetMovements: '/asset-movements',
      standby: '/standby',
      dashboard: '/dashboard',
      admin: '/admin',
      tickets: '/tickets',
      jobs: '/jobs',
      requisitions: '/requisitions',
      deliveryTickets: '/delivery-tickets',
      reconciliations: '/reconciliations',
      systemConfig: '/settings/system-config',
      companySettings: '/settings/company',
      emailSettings: '/settings/email',
      smsSettings: '/settings/sms',
      consumables: '/consumables',
      consumableRequests: '/consumables/requests',
      licenses: '/licenses',
      repairHistory: '/repair-history',
      faultAnalysis: '/fault-analysis',
      sla: '/sla',
      serviceReports: '/service-reports',
      assetReports: '/asset-reports',
      gatePasses: '/gate-passes',
      notifications: '/notifications',
      auditLogs: '/audit-logs',
      backups: '/backups'
    },
    documentation: '/docs',
    health: '/health',
    timestamp: new Date().toISOString()
  });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/oauth', oauthRoutes);
router.use('/users', userRoutes);
router.use('/departments', departmentRoutes);
router.use('/boards', boardRoutes);
router.use('/masters', masterRoutes);
router.use('/assets', assetRoutes);
router.use('/asset-movements', assetMovementRoutes);
router.use('/standby', standbyRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/admin', adminRoutes);
router.use('/tickets', ticketRoutes);
router.use('/jobs', jobRoutes);
router.use('/requisitions', requisitionRoutes);
router.use('/delivery-tickets', deliveryTicketRoutes);
router.use('/reconciliations', reconciliationRoutes);
router.use('/settings/system-config', systemConfigRoutes);
router.use('/settings/company', companySettingsRoutes);
router.use('/settings/email', emailSettingsRoutes);
router.use('/settings/sms', smsSettingsRoutes);
// IMPORTANT: Mount specific routes before generic ones to prevent /:id from matching 'requests'
router.use('/consumables/requests', consumableRequestRoutes);
router.use('/consumables', consumableRoutes);
router.use('/licenses', licenseRoutes);
router.use('/repair-history', repairHistoryRoutes);
router.use('/fault-analysis', faultAnalysisRoutes);
router.use('/sla', slaRoutes);
router.use('/service-reports', serviceReportRoutes);
router.use('/asset-reports/job-reports', assetJobReportRoutes);
router.use('/reports', reportRoutes);
router.use('/gate-passes', gatePassRoutes);
router.use('/notifications', notificationRoutes);
router.use('/audit-logs', auditLogRoutes);
router.use('/backups', backupRoutes);


// API version info
router.get('/version', (req, res) => {
  res.status(200).json({
    api_version: '1.0.0',
    node_version: process.version,
    uptime: process.uptime(),
    memory_usage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
