const express = require('express');
const Joi = require('joi');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireRole } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { roles: USER_ROLES } = require('../../config/auth');

const router = express.Router({ mergeParams: true });

// Apply authentication to all routes
router.use(authenticateToken);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const resolveDiscrepancySchema = Joi.object({
  resolution_action: Joi.string()
    .valid('updated_system', 'updated_physical', 'verified_correct', 'accepted_as_is', 'escalated')
    .required(),
  resolution_notes: Joi.string().max(5000).allow(null, '').optional()
});

// ============================================================================
// ROUTE: GET /reconciliations/:id/discrepancies
// Get all discrepancies for a reconciliation process with filters
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { id: reconciliationId } = req.params;
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const {
      field_name,
      discrepancy_type,
      severity,
      is_resolved,
      search
    } = req.query;

    const pool = await connectDB();

    // Verify reconciliation exists
    const reconciliationCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query('SELECT id FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (reconciliationCheck.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    // Build WHERE clause
    let whereClause = 'd.reconciliation_record_id IN (SELECT id FROM RECONCILIATION_RECORDS WHERE reconciliation_id = @reconciliationId)';
    const params = [
      { name: 'reconciliationId', type: sql.UniqueIdentifier, value: reconciliationId }
    ];

    if (field_name) {
      whereClause += ' AND d.field_name = @fieldName';
      params.push({ name: 'fieldName', type: sql.VarChar(100), value: field_name });
    }

    if (discrepancy_type) {
      whereClause += ' AND d.discrepancy_type = @discrepancyType';
      params.push({ name: 'discrepancyType', type: sql.VarChar(50), value: discrepancy_type });
    }

    if (severity) {
      whereClause += ' AND d.severity = @severity';
      params.push({ name: 'severity', type: sql.VarChar(20), value: severity });
    }

    if (is_resolved !== undefined) {
      const resolvedValue = is_resolved === 'true' || is_resolved === '1';
      whereClause += ' AND d.is_resolved = @isResolved';
      params.push({ name: 'isResolved', type: sql.Bit, value: resolvedValue });
    }

    if (search) {
      whereClause += ' AND (d.field_display_name LIKE @search OR d.system_value LIKE @search OR d.physical_value LIKE @search OR a.asset_tag LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    // Build ORDER BY clause
    const validSortColumns = {
      detected_at: 'd.detected_at',
      severity: 'd.severity',
      field_name: 'd.field_name',
      discrepancy_type: 'd.discrepancy_type',
      is_resolved: 'd.is_resolved',
      asset_tag: 'a.asset_tag'
    };
    const orderByColumn = validSortColumns[sortBy] || 'd.detected_at';
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total records
    let countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM RECONCILIATION_DISCREPANCIES d
      INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
      LEFT JOIN assets a ON rr.asset_id = a.id
      WHERE ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Fetch paginated data
    let dataRequest = pool.request()
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset);

    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    // const result = await dataRequest.query(`
    //   SELECT
    //     d.*,
    //     a.asset_tag,
    //     p.name as product_name,
    //     a.serial_number,
    //     CONCAT(detector.first_name, ' ', detector.last_name) as detected_by_name,
    //     CONCAT(resolver.first_name, ' ', resolver.last_name) as resolved_by_name
    //   FROM RECONCILIATION_DISCREPANCIES d
    //   INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
    //   LEFT JOIN assets a ON rr.asset_id = a.id
    //   LEFT JOIN products p ON a.product_id = p.id
    //   LEFT JOIN USER_MASTER detector ON d.detected_by = detector.user_id
    //   LEFT JOIN USER_MASTER resolver ON d.resolved_by = resolver.user_id
    //   WHERE ${whereClause}
    //   ORDER BY ${orderByColumn} ${orderDirection}
    //   OFFSET @offset ROWS
    //   FETCH NEXT @limit ROWS ONLY
    // `);

    const result = await dataRequest.query(`
      SELECT
        d.id,
        d.reconciliation_record_id,
        d.field_name,
        d.field_display_name,
    
        CASE
            WHEN d.field_name = 'location'
            THEN CONCAT(
                l.name,
                CASE
                    WHEN l.floor IS NOT NULL
                         AND LTRIM(RTRIM(CAST(l.floor AS VARCHAR(20)))) <> ''
                    THEN ' - Floor ' + CAST(l.floor AS VARCHAR(20))
                    ELSE ''
                END
            )
            ELSE d.system_value
        END AS system_value,
    
        d.physical_value,
        d.discrepancy_type,
        d.severity,
        d.detected_by,
        d.detected_at,
        d.is_resolved,
        d.resolved_by,
        d.resolved_at,
        d.resolution_action,
        d.resolution_notes,
        d.created_at,
        d.updated_at,
    
        a.asset_tag,
        p.name AS product_name,
        a.serial_number,
    
        CONCAT(detector.first_name, ' ', detector.last_name) AS detected_by_name,
        CONCAT(resolver.first_name, ' ', resolver.last_name) AS resolved_by_name
    
        FROM RECONCILIATION_DISCREPANCIES d
        INNER JOIN RECONCILIATION_RECORDS rr
            ON d.reconciliation_record_id = rr.id
        
        LEFT JOIN assets a
            ON rr.asset_id = a.id
        
        LEFT JOIN locations l
            ON a.location_id = l.id
        
        LEFT JOIN products p
            ON a.product_id = p.id
        
        LEFT JOIN USER_MASTER detector
            ON d.detected_by = detector.user_id
        
        LEFT JOIN USER_MASTER resolver
            ON d.resolved_by = resolver.user_id
        
        WHERE ${whereClause}
        
        ORDER BY ${orderByColumn} ${orderDirection}
        
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
    `);

    sendSuccess(res, {
      discrepancies: result.recordset,
      pagination: getPaginationInfo(page, limit, total)
    }, 'Discrepancies retrieved successfully');
  })
);

// ============================================================================
// ROUTE: GET /reconciliations/:id/discrepancies/statistics
// Get discrepancy statistics for a reconciliation process
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/statistics',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  asyncHandler(async (req, res) => {
    const { id: reconciliationId } = req.params;

    const pool = await connectDB();

    // Verify reconciliation exists
    const reconciliationCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query('SELECT id FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (reconciliationCheck.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    // Get overall statistics
    const statsResult = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .query(`
        SELECT
          COUNT(*) as total_discrepancies,
          SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as resolved_count,
          SUM(CASE WHEN is_resolved = 0 THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
          SUM(CASE WHEN severity = 'major' THEN 1 ELSE 0 END) as major_count,
          SUM(CASE WHEN severity = 'minor' THEN 1 ELSE 0 END) as minor_count
        FROM RECONCILIATION_DISCREPANCIES d
        INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
        WHERE rr.reconciliation_id = @reconciliationId
      `);

    // Get by discrepancy type
    const byTypeResult = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .query(`
        SELECT
          discrepancy_type,
          COUNT(*) as count,
          SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as resolved
        FROM RECONCILIATION_DISCREPANCIES d
        INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
        WHERE rr.reconciliation_id = @reconciliationId
        GROUP BY discrepancy_type
        ORDER BY count DESC
      `);

    // Get by field name
    const byFieldResult = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .query(`
        SELECT
          field_name,
          field_display_name,
          COUNT(*) as count
        FROM RECONCILIATION_DISCREPANCIES d
        INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
        WHERE rr.reconciliation_id = @reconciliationId
        GROUP BY field_name, field_display_name
        ORDER BY count DESC
      `);

    // Get resolution action breakdown (for resolved discrepancies)
    const resolutionActionsResult = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .query(`
        SELECT
          resolution_action,
          COUNT(*) as count
        FROM RECONCILIATION_DISCREPANCIES d
        INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
        WHERE rr.reconciliation_id = @reconciliationId
          AND is_resolved = 1
          AND resolution_action IS NOT NULL
        GROUP BY resolution_action
        ORDER BY count DESC
      `);

    const stats = statsResult.recordset[0];

    sendSuccess(res, {
      summary: {
        total: stats.total_discrepancies || 0,
        resolved: stats.resolved_count || 0,
        pending: stats.pending_count || 0,
        resolution_rate: stats.total_discrepancies > 0
          ? Math.round((stats.resolved_count / stats.total_discrepancies) * 100)
          : 0
      },
      by_severity: {
        critical: stats.critical_count || 0,
        major: stats.major_count || 0,
        minor: stats.minor_count || 0
      },
      by_type: byTypeResult.recordset,
      by_field: byFieldResult.recordset,
      resolution_actions: resolutionActionsResult.recordset
    }, 'Discrepancy statistics retrieved successfully');
  })
);

// ============================================================================
// ROUTE: GET /reconciliations/:id/assets/:assetId/discrepancies
// Get discrepancies for a specific asset
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/assets/:assetId',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('assetId'),
  asyncHandler(async (req, res) => {
    const { id: reconciliationId, assetId } = req.params;

    const pool = await connectDB();

    // Get reconciliation record
    const recordCheck = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT id FROM RECONCILIATION_RECORDS
        WHERE reconciliation_id = @reconciliationId AND asset_id = @assetId
      `);

    if (recordCheck.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found in this reconciliation');
    }

    const recordId = recordCheck.recordset[0].id;

    // Get all discrepancies for this asset
    const discrepancies = await pool.request()
      .input('recordId', sql.UniqueIdentifier, recordId)
      .query(`
        SELECT
          d.*,
          CONCAT(detector.first_name, ' ', detector.last_name) as detected_by_name,
          CONCAT(resolver.first_name, ' ', resolver.last_name) as resolved_by_name
        FROM RECONCILIATION_DISCREPANCIES d
        LEFT JOIN USER_MASTER detector ON d.detected_by = detector.user_id
        LEFT JOIN USER_MASTER resolver ON d.resolved_by = resolver.user_id
        WHERE d.reconciliation_record_id = @recordId
        ORDER BY
          CASE d.severity
            WHEN 'critical' THEN 1
            WHEN 'major' THEN 2
            WHEN 'minor' THEN 3
          END,
          d.detected_at ASC
      `);

    sendSuccess(res, {
      asset_id: assetId,
      reconciliation_record_id: recordId,
      discrepancies: discrepancies.recordset,
      count: discrepancies.recordset.length
    }, 'Asset discrepancies retrieved successfully');
  })
);

// ============================================================================
// ROUTE: PUT /discrepancies/:discrepancyId/resolve
// Resolve a discrepancy
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.put('/:discrepancyId/resolve',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('discrepancyId'),
  validateBody(resolveDiscrepancySchema),
  asyncHandler(async (req, res) => {
    const { discrepancyId } = req.params;
    const { resolution_action, resolution_notes } = req.body;
    const userId = req.user.id;

    const pool = await connectDB();

    // Check if discrepancy exists
    const discrepancyCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, discrepancyId)
      .query('SELECT id, is_resolved FROM RECONCILIATION_DISCREPANCIES WHERE id = @id');

    if (discrepancyCheck.recordset.length === 0) {
      return sendNotFound(res, 'Discrepancy not found');
    }

    const discrepancy = discrepancyCheck.recordset[0];

    if (discrepancy.is_resolved) {
      return sendError(res, 'Discrepancy is already resolved', 400);
    }

    // Resolve the discrepancy
    await pool.request()
      .input('id', sql.UniqueIdentifier, discrepancyId)
      .input('resolutionAction', sql.VarChar(100), resolution_action)
      .input('resolutionNotes', sql.Text, resolution_notes || null)
      .input('resolvedBy', sql.UniqueIdentifier, userId)
      .query(`
        UPDATE RECONCILIATION_DISCREPANCIES
        SET
          is_resolved = 1,
          resolved_by = @resolvedBy,
          resolved_at = GETUTCDATE(),
          resolution_action = @resolutionAction,
          resolution_notes = @resolutionNotes,
          updated_at = GETUTCDATE()
        WHERE id = @id
      `);

    // Fetch updated discrepancy
    const updated = await pool.request()
      .input('id', sql.UniqueIdentifier, discrepancyId)
      .query(`
        SELECT
          d.*,
          CONCAT(detector.first_name, ' ', detector.last_name) as detected_by_name,
          CONCAT(resolver.first_name, ' ', resolver.last_name) as resolved_by_name
        FROM RECONCILIATION_DISCREPANCIES d
        LEFT JOIN USER_MASTER detector ON d.detected_by = detector.user_id
        LEFT JOIN USER_MASTER resolver ON d.resolved_by = resolver.user_id
        WHERE d.id = @id
      `);

    sendSuccess(res, updated.recordset[0], 'Discrepancy resolved successfully');
  })
);

// ============================================================================
// ROUTE: GET /reconciliations/:id/discrepancies/export
// Export discrepancies to CSV format
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/export',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  asyncHandler(async (req, res) => {
    const { id: reconciliationId } = req.params;
    const { format = 'csv' } = req.query;

    const pool = await connectDB();

    // Verify reconciliation exists
    const reconciliationCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query('SELECT reconciliation_name FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (reconciliationCheck.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliationName = reconciliationCheck.recordset[0].reconciliation_name;

    // Fetch all discrepancies with full details
    const result = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .query(`
        SELECT
          a.asset_tag,
          a.serial_number,
          p.name as product_name,
          d.field_display_name,
          d.discrepancy_type,
          d.severity,
          d.system_value,
          d.physical_value,
          CASE WHEN d.is_resolved = 1 THEN 'Resolved' ELSE 'Pending' END as status,
          CONCAT(detector.first_name, ' ', detector.last_name) as detected_by,
          detector.email as detected_by_email,
          FORMAT(d.detected_at, 'yyyy-MM-dd HH:mm:ss') as detected_at,
          CONCAT(resolver.first_name, ' ', resolver.last_name) as resolved_by,
          resolver.email as resolved_by_email,
          FORMAT(d.resolved_at, 'yyyy-MM-dd HH:mm:ss') as resolved_at,
          d.resolution_action,
          d.resolution_notes
        FROM RECONCILIATION_DISCREPANCIES d
        INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
        LEFT JOIN assets a ON rr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN USER_MASTER detector ON d.detected_by = detector.user_id
        LEFT JOIN USER_MASTER resolver ON d.resolved_by = resolver.user_id
        WHERE rr.reconciliation_id = @reconciliationId
        ORDER BY d.severity DESC, d.detected_at ASC
      `);

    const discrepancies = result.recordset;

    if (discrepancies.length === 0) {
      return sendError(res, 'No discrepancies found for this reconciliation', 404);
    }

    // Generate CSV format
    if (format === 'csv') {
      // CSV Headers
      const headers = [
        'Asset Tag',
        'Serial Number',
        'Product',
        'Field',
        'Type',
        'Severity',
        'System Value',
        'Physical Value',
        'Status',
        'Detected By',
        'Detected Email',
        'Detected At',
        'Resolved By',
        'Resolved Email',
        'Resolved At',
        'Resolution Action',
        'Resolution Notes'
      ];

      // Build CSV content
      let csvContent = headers.join(',') + '\n';

      discrepancies.forEach(row => {
        const values = [
          `"${row.asset_tag || ''}"`,
          `${row.serial_number || ''}`,
          `"${row.product_name || ''}"`,
          `"${row.field_display_name || ''}"`,
          `"${row.discrepancy_type || ''}"`,
          `"${row.severity || ''}"`,
          `"${(row.system_value || '').replace(/"/g, '""')}"`,
          `"${(row.physical_value || '').replace(/"/g, '""')}"`,
          `"${row.status || ''}"`,
          `"${row.detected_by || ''}"`,
          `"${row.detected_by_email || ''}"`,
          `"${row.detected_at || ''}"`,
          `"${row.resolved_by || ''}"`,
          `"${row.resolved_by_email || ''}"`,
          `"${row.resolved_at || ''}"`,
          `"${row.resolution_action || ''}"`,
          `"${(row.resolution_notes || '').replace(/"/g, '""')}"`
        ];
        csvContent += values.join(',') + '\n';
      });

      // Set headers for file download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${reconciliationName.replace(/[^a-zA-Z0-9]/g, '_')}_discrepancies_${timestamp}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } else {
      return sendError(res, 'Unsupported export format. Use format=csv', 400);
    }
  })
);

// ============================================================================
// ROUTE: GET /discrepancies/:discrepancyId
// Get single discrepancy details
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/:discrepancyId',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('discrepancyId'),
  asyncHandler(async (req, res) => {
    const { discrepancyId } = req.params;

    const pool = await connectDB();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, discrepancyId)
      .query(`
        SELECT
          d.*,
          a.asset_tag,
          p.name as product_name,
          a.serial_number,
          rr.reconciliation_id,
          CONCAT(detector.first_name, ' ', detector.last_name) as detected_by_name,
          detector.email as detected_by_email,
          CONCAT(resolver.first_name, ' ', resolver.last_name) as resolved_by_name,
          resolver.email as resolved_by_email
        FROM RECONCILIATION_DISCREPANCIES d
        INNER JOIN RECONCILIATION_RECORDS rr ON d.reconciliation_record_id = rr.id
        LEFT JOIN assets a ON rr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN USER_MASTER detector ON d.detected_by = detector.user_id
        LEFT JOIN USER_MASTER resolver ON d.resolved_by = resolver.user_id
        WHERE d.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Discrepancy not found');
    }

    sendSuccess(res, result.recordset[0], 'Discrepancy retrieved successfully');
  })
);

module.exports = router;
