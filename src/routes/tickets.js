/**
 * TICKET ROUTES
 * API endpoints for ticket management system
 */

const express = require('express');
const router = express.Router();
const TicketController = require('../controllers/ticketController');
const TicketAssetsController = require('../controllers/ticketAssetsController');
const { authenticateOAuth } = require('../middleware/oauth-auth');
const { requireRole } = require('../middleware/permissions');

// Roles that can manage tickets
const TICKET_MANAGERS = ['it_head', 'coordinator', 'superadmin', 'department_coordinator', 'admin', 'engineer', 'department_head'];
const COORDINATORS = ['it_head', 'coordinator', 'superadmin', 'department_coordinator', 'admin'];
const ALL_AUTHENTICATED = ['it_head', 'coordinator', 'superadmin', 'department_coordinator', 'admin', 'engineer', 'employee', 'department_head'];

/**
 * @route   GET /api/tickets/my-assets
 * @desc    Get current user's assigned assets for ticket creation
 * @access  All authenticated users
 */
router.get(
  '/my-assets',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketAssetsController.getEmployeeAssets
);

/**
 * @route   GET /api/tickets/employee-assets/:userId
 * @desc    Get specific employee's assigned assets for ticket creation
 * @access  Coordinators, Admins, Engineers
 */
router.get(
  '/employee-assets/:userId',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketAssetsController.getEmployeeAssets
);

/**
 * @route   GET /api/tickets/my-software
 * @desc    Get software installed on current user's assets for ticket creation
 * @access  All authenticated users
 */
router.get(
  '/my-software',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketAssetsController.getEmployeeSoftware
);

/**
 * @route   GET /api/tickets/employee-software/:userId
 * @desc    Get software installed on specific employee's assets for ticket creation
 * @access  Coordinators, Admins, Engineers
 */
router.get(
  '/employee-software/:userId',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketAssetsController.getEmployeeSoftware
);

/**
 * @route   GET /api/tickets/filter-options
 * @desc    Get dynamic filter options based on existing data
 * @access  Coordinator, Superadmin, Admin, Engineer
 */
router.get(
  '/filter-options',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getFilterOptions
);

/**
 * @route   GET /api/tickets/my-tickets
 * @desc    Get tickets assigned to current engineer
 * @access  Engineer
 */
router.get(
  '/my-tickets',
  authenticateOAuth,
  requireRole(['engineer']),
  TicketController.getMyTickets
);

/**
 * @route   GET /api/tickets/my-created-tickets
 * @desc    Get tickets created by current user (employee view)
 * @access  All authenticated users
 */
router.get(
  '/my-created-tickets',
  authenticateOAuth,
  TicketController.getMyCreatedTickets
);

/**
 * @route   GET /api/tickets/pending-close-requests
 * @desc    Get pending close requests for coordinator review
 * @access  Coordinator, Superadmin
 */
router.get(
  '/pending-close-requests',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.getPendingCloseRequests
);

/**
 * @route   GET /api/tickets/close-requests-count
 * @desc    Get count of pending close requests (for badge)
 * @access  Coordinator, Superadmin
 */
router.get(
  '/close-requests-count',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.getCloseRequestCount
);

/**
 * @route   GET /api/tickets/pending-service-type-requests
 * @desc    Get pending service type change requests for coordinator review
 * @access  Coordinator, Superadmin
 */
router.get(
  '/pending-service-type-requests',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.getPendingServiceTypeRequests
);

/**
 * @route   GET /api/tickets/stats
 * @desc    Get ticket statistics for dashboard
 * @access  Coordinator, Superadmin
 */
router.get(
  '/stats',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getTicketStats
);

/**
 * @route   GET /api/tickets/engineers
 * @desc    Get available engineers for assignment
 * @access  Coordinator, Superadmin
 */
router.get(
  '/engineers',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getAvailableEngineers
);

/**
 * @route   GET /api/tickets/employees
 * @desc    Get employees for ticket creation
 * @access  Coordinator, Superadmin
 */
router.get(
  '/employees',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getEmployees
);

/**
 * @route   GET /api/tickets/export
 * @desc    Export tickets to Excel
 * @access  Coordinator, Superadmin
 */
router.get(
  '/export',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.exportTickets
);

/**
 * @route   GET /api/tickets/trend-analysis
 * @desc    Get ticket trend analysis over time
 * @access  Coordinator, Admin, Superadmin
 */
router.get(
  '/trend-analysis',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.getTrendAnalysis
);

/**
 * @route   GET /api/tickets/trend-analysis/export
 * @desc    Export ticket trend analysis to Excel
 * @access  Coordinator, Admin, Superadmin
 */
router.get(
  '/trend-analysis/export',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.exportTrendAnalysis
);

/**
 * @route   GET /api/tickets/reopen-config
 * @desc    Get ticket reopen configuration
 * @access  Superadmin only
 */
router.get(
  '/reopen-config',
  authenticateOAuth,
  requireRole(['superadmin']),
  TicketController.getReopenConfig
);

/**
 * @route   PUT /api/tickets/reopen-config
 * @desc    Update ticket reopen configuration
 * @access  Superadmin only
 */
router.put(
  '/reopen-config',
  authenticateOAuth,
  requireRole(['superadmin']),
  TicketController.updateReopenConfig
);

/**
 * @route   GET /api/tickets/:ticketId/can-reopen
 * @desc    Check if a ticket can be reopened
 * @access  Coordinator, Admin, Superadmin
 */
router.get(
  '/:ticketId/can-reopen',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.canReopenTicket
);

/**
 * @route   POST /api/tickets/:ticketId/reopen
 * @desc    Reopen a closed ticket
 * @access  Coordinator, Admin, Superadmin
 */
router.post(
  '/:ticketId/reopen',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.reopenTicket
);

/**
 * @route   GET /api/tickets/:ticketId/reopen-history
 * @desc    Get reopen history for a ticket
 * @access  Coordinator, Admin, Superadmin, Engineer
 */
router.get(
  '/:ticketId/reopen-history',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getReopenHistory
);

/**
 * @route   GET /api/tickets/:id/assets
 * @desc    Get all assets linked to a ticket
 * @access  All authenticated (employees can only view their own tickets)
 */
router.get(
  '/:id/assets',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketAssetsController.getTicketAssets
);

/**
 * @route   GET /api/tickets/:id/assets/count
 * @desc    Get count of assets linked to a ticket
 * @access  All authenticated (employees can only view their own tickets)
 */
router.get(
  '/:id/assets/count',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketAssetsController.getAssetCount
);

/**
 * @route   GET /api/tickets/:id/software
 * @desc    Get all software linked to a ticket
 * @access  All authenticated (employees can only view their own tickets)
 */
router.get(
  '/:id/software',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketAssetsController.getTicketSoftware
);

/**
 * @route   DELETE /api/tickets/:ticketId/software/:installationId
 * @desc    Unlink software from a ticket
 * @access  Coordinator, Admin, Engineer (assigned only)
 */
router.delete(
  '/:ticketId/software/:installationId',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketAssetsController.unlinkSoftware
);

/**
 * @route   GET /api/tickets/:id/comments
 * @desc    Get comments for a ticket
 * @access  All authenticated (employees can only view their own tickets)
 */
router.get(
  '/:id/comments',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketController.getComments
);

/**
 * @route   GET /api/tickets/:id/close-request-history
 * @desc    Get close request history for a ticket
 * @access  All authenticated (employees can only view their own tickets)
 */
router.get(
  '/:id/close-request-history',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketController.getCloseRequestHistory
);

/**
 * @route   GET /api/tickets/:id
 * @desc    Get single ticket by ID
 * @access  All authenticated (employees can only view their own tickets)
 */
router.get(
  '/:id',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketController.getTicketById
);

/**
 * @route   GET /api/tickets
 * @desc    Get all tickets with filters and pagination
 * @access  Coordinator, Superadmin
 */
router.get(
  '/',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.getTickets
);

/**
 * @route   POST /api/tickets
 * @desc    Create new ticket
 * @access  All authenticated users
 */
router.post(
  '/',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketController.createTicket
);

/**
 * @route   POST /api/tickets/:id/comments
 * @desc    Add comment to ticket
 * @access  All authenticated users (employees can only comment on their own tickets)
 */
router.post(
  '/:id/comments',
  authenticateOAuth,
  requireRole(ALL_AUTHENTICATED),
  TicketController.addComment
);

/**
 * @route   POST /api/tickets/:id/assets
 * @desc    Link an asset to a ticket
 * @access  Coordinator, Superadmin, Engineer
 */
router.post(
  '/:id/assets',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketAssetsController.linkAsset
);

/**
 * @route   POST /api/tickets/:id/assets/bulk
 * @desc    Link multiple assets to a ticket
 * @access  Coordinator, Superadmin, Engineer
 */
router.post(
  '/:id/assets/bulk',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketAssetsController.linkMultipleAssets
);

/**
 * @route   POST /api/tickets/:id/request-close
 * @desc    Engineer requests to close a ticket
 * @access  Engineer
 */
router.post(
  '/:id/request-close',
  authenticateOAuth,
  requireRole(['engineer']),
  TicketController.requestTicketClose
);

/**
 * @route   PUT /api/tickets/:id/assign
 * @desc    Assign engineer to ticket
 * @access  Coordinator, Superadmin
 */
router.put(
  '/:id/assign',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.assignEngineer
);

/**
 * @route   PUT /api/tickets/:id/close
 * @desc    Close ticket (coordinators only - direct close)
 * @access  Coordinator, Superadmin
 */
router.put(
  '/:id/close',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.closeTicket
);

/**
 * @route   PUT /api/tickets/:id/review-close-request
 * @desc    Coordinator approves or rejects engineer close request
 * @access  Coordinator, Superadmin
 */
router.put(
  '/:id/review-close-request',
  authenticateOAuth,
  requireRole(COORDINATORS),
  TicketController.reviewCloseRequest
);

/**
 * @route   POST /api/tickets/:id/request-service-type-change
 * @desc    Engineer requests to change service type (repair/replace)
 * @access  Engineer
 */
 // router.post(
 //   '/:id/request-service-type-change',
 //   authenticateOAuth,
 //   requireRole(['engineer']),
 //   TicketController.requestServiceTypeChange
 // );

/**
 * @route   PUT /api/tickets/:id/review-service-type-change
 * @desc    Coordinator approves or rejects service type change request
 * @access  Coordinator, Superadmin
 */
 // router.put(
 //   '/:id/review-service-type-change',
 //   authenticateOAuth,
 //   requireRole(COORDINATORS),
 //   TicketController.reviewServiceTypeChange
 // );

/**
 * @route   GET /api/tickets/:id/service-type-requests
 * @desc    Get service type change request history for a ticket
 * @access  All ticket managers
 */
 // router.get(
 //   '/:id/service-type-requests',
 //   authenticateOAuth,
 //   requireRole(TICKET_MANAGERS),
 //   TicketController.getServiceTypeRequestsByTicketId
 // );

/**
 * @route   PUT /api/tickets/:id
 * @desc    Update ticket
 * @access  Coordinator, Superadmin
 */
router.put(
  '/:id',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketController.updateTicket
);

/**
 * @route   DELETE /api/tickets/:ticketId/assets/:assetId
 * @desc    Unlink an asset from a ticket
 * @access  Coordinator, Superadmin, Engineer
 */
router.delete(
  '/:ticketId/assets/:assetId',
  authenticateOAuth,
  requireRole(TICKET_MANAGERS),
  TicketAssetsController.unlinkAsset
);

module.exports = router;
