const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireRole } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { roles: USER_ROLES } = require('../../config/auth');

const router = express.Router({ mergeParams: true }); // mergeParams to access :id from parent router

// Apply authentication to all routes
router.use(authenticateToken);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const bulkAddAssetsSchema = Joi.object({
  asset_ids: Joi.array().items(Joi.string().uuid()).min(1).required()
});

const reconcileAssetSchema = Joi.object({
  reconciliation_status: Joi.string()
    .valid('verified', 'discrepancy', 'missing', 'damaged')
    .required(),
  physical_location: Joi.string().max(255).allow(null, '').optional(),
  physical_condition: Joi.string().max(100).allow(null, '').optional(),
  physical_assigned_to: Joi.string().uuid().allow(null).optional(),
  physical_serial_number: Joi.string().max(100).allow(null, '').optional(),
  physical_status: Joi.string().max(50).allow(null, '').optional(),
  discrepancy_notes: Joi.string().max(5000).allow(null, '').optional()
});

const bulkReconcileSchema = Joi.object({
  asset_ids: Joi.array().items(Joi.string().uuid()).min(1).required(),
  reconciliation_status: Joi.string()
    .valid('verified', 'discrepancy', 'missing', 'damaged')
    .required(),
  physical_location: Joi.string().max(255).allow(null, '').optional(),
  physical_condition: Joi.string().max(100).allow(null, '').optional(),
  physical_assigned_to: Joi.string().uuid().allow(null).optional(),
  physical_serial_number: Joi.string().max(100).allow(null, '').optional(),
  physical_status: Joi.string().max(50).allow(null, '').optional(),
  discrepancy_notes: Joi.string().max(5000).allow(null, '').optional()
});

// ============================================================================
// HELPER FUNCTIONS FOR DISCREPANCY DETECTION
// ============================================================================

/**
 * Detect discrepancies by comparing system snapshot with physical values
 * @param {Object} systemSnapshot - Parsed system snapshot JSON
 * @param {Object} physicalValues - Physical values from reconciliation
 * @param {Object} assetData - Full asset data for additional fields
 * @returns {Array} Array of discrepancy objects
 */
function detectDiscrepancies(systemSnapshot, physicalValues, assetData = {}) {

    console.log('========== DEBUG ==========');
  console.log('SYSTEM SNAPSHOT:', systemSnapshot);
  console.log('PHYSICAL VALUES:', physicalValues);

  console.log('SYSTEM DEPARTMENT:', systemSnapshot.department);
  console.log('PHYSICAL DEPARTMENT:', physicalValues.physical_department);
  const discrepancies = [];

  // Helper to get user display name
  const getUserDisplayName = (userId, userName) => {
    if (userName) return userName;
    if (userId) return `User ID: ${userId}`;
    return 'Unassigned';
  };

  // 1. Location discrepancy
  if (physicalValues.physical_location && systemSnapshot.location_name) {
    if (physicalValues.physical_location.trim() !== systemSnapshot.location_name.trim()) {
      discrepancies.push({
        field_name: 'location',
        field_display_name: 'Location',
        system_value: systemSnapshot.location_name || 'N/A',
        physical_value: physicalValues.physical_location,
        discrepancy_type: 'location_mismatch',
        severity: 'major'
      });
    }
  }

  // 2. Condition discrepancy
  if (physicalValues.physical_condition && systemSnapshot.condition_status) {
    if (physicalValues.physical_condition.toLowerCase() !== systemSnapshot.condition_status.toLowerCase()) {
      // Determine severity based on condition change
      let severity = 'minor';
      const badConditions = ['damaged', 'poor', 'broken', 'faulty'];
      if (badConditions.includes(physicalValues.physical_condition.toLowerCase())) {
        severity = 'critical';
      }

      discrepancies.push({
        field_name: 'condition',
        field_display_name: 'Condition Status',
        system_value: systemSnapshot.condition_status || 'N/A',
        physical_value: physicalValues.physical_condition,
        discrepancy_type: 'condition_changed',
        severity: severity
      });
    }
  }

  // 3. Assignment discrepancy
  if (physicalValues.physical_assigned_to && systemSnapshot.assigned_to) {
    if (physicalValues.physical_assigned_to !== systemSnapshot.assigned_to) {
      discrepancies.push({
        field_name: 'assigned_to',
        field_display_name: 'Assigned To',
        system_value: getUserDisplayName(systemSnapshot.assigned_to, assetData.assigned_user_name),
        physical_value: getUserDisplayName(physicalValues.physical_assigned_to, physicalValues.physical_assigned_to_name),
        discrepancy_type: 'assignment_mismatch',
        severity: 'major'
      });
    }
  }

  // 4. Serial number discrepancy
  if (physicalValues.physical_serial_number && systemSnapshot.serial_number) {
    if (physicalValues.physical_serial_number.trim() !== systemSnapshot.serial_number.trim()) {
      discrepancies.push({
        field_name: 'serial_number',
        field_display_name: 'Serial Number',
        system_value: systemSnapshot.serial_number || 'N/A',
        physical_value: physicalValues.physical_serial_number,
        discrepancy_type: 'serial_number_mismatch',
        severity: 'critical'
      });
    }
  }

  // 5. Status discrepancy
  if (physicalValues.physical_status && systemSnapshot.status) {
    if (physicalValues.physical_status.toLowerCase() !== systemSnapshot.status.toLowerCase()) {
      discrepancies.push({
        field_name: 'status',
        field_display_name: 'Asset Status',
        system_value: systemSnapshot.status || 'N/A',
        physical_value: physicalValues.physical_status,
        discrepancy_type: 'status_mismatch',
        severity: 'major'
      });
    }
  }


  // 6. Department discrepancy
if (
  physicalValues.physical_department &&
  systemSnapshot.department
) {
  if (
    physicalValues.physical_department.trim().toLowerCase() !==
    systemSnapshot.department.trim().toLowerCase()
  ) {
    discrepancies.push({
      field_name: 'department',
      field_display_name: 'Department',
      system_value: systemSnapshot.department,
      physical_value: physicalValues.physical_department,
      discrepancy_type: 'department_mismatch',
      severity: 'major'
    });
  }
}

  return discrepancies;
}

/**
 * Insert discrepancies into database
 * @param {Object} transaction - SQL transaction
 * @param {String} reconciliationRecordId - Reconciliation record UUID
 * @param {Array} discrepancies - Array of discrepancy objects
 * @param {String} detectedBy - User UUID who detected the discrepancies
 * @returns {Promise<Number>} Number of discrepancies inserted
 */
async function insertDiscrepancies(transaction, reconciliationRecordId, discrepancies, detectedBy) {
  if (!discrepancies || discrepancies.length === 0) {
    return 0;
  }

  for (const disc of discrepancies) {
    const discrepancyId = uuidv4();

    await transaction.request()
      .input('id', sql.UniqueIdentifier, discrepancyId)
      .input('reconciliationRecordId', sql.UniqueIdentifier, reconciliationRecordId)
      .input('fieldName', sql.VarChar(100), disc.field_name)
      .input('fieldDisplayName', sql.VarChar(200), disc.field_display_name)
      .input('systemValue', sql.NVarChar(500), disc.system_value || null)
      .input('physicalValue', sql.NVarChar(500), disc.physical_value || null)
      .input('discrepancyType', sql.VarChar(50), disc.discrepancy_type)
      .input('severity', sql.VarChar(20), disc.severity)
      .input('detectedBy', sql.UniqueIdentifier, detectedBy)
      .query(`
        INSERT INTO RECONCILIATION_DISCREPANCIES (
          id, reconciliation_record_id, field_name, field_display_name,
          system_value, physical_value, discrepancy_type, severity,
          detected_by, detected_at, created_at, updated_at
        )
        VALUES (
          @id, @reconciliationRecordId, @fieldName, @fieldDisplayName,
          @systemValue, @physicalValue, @discrepancyType, @severity,
          @detectedBy, GETUTCDATE(), GETUTCDATE(), GETUTCDATE()
        )
      `);
  }

  // Update has_discrepancies flag
  await transaction.request()
    .input('reconciliationRecordId', sql.UniqueIdentifier, reconciliationRecordId)
    .query(`
      UPDATE RECONCILIATION_RECORDS
      SET has_discrepancies = 1, updated_at = GETUTCDATE()
      WHERE id = @reconciliationRecordId
    `);

  return discrepancies.length;
}

// ============================================================================
// ROUTE: GET /reconciliations/:id/assets
// Get all assets for a reconciliation process (similar to asset inventory)
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { id: reconciliationId } = req.params;
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const {
      search,
      status,
      reconciliation_status,
      category_id,
      location_id,
      assigned_to,
      department_id
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
    let whereClause = 'a.is_active = 1 AND (a.is_standby_asset = 0 OR a.is_standby_asset IS NULL)';
    const params = [];

    if (search) {
      whereClause += ' AND (a.asset_tag LIKE @search OR p.name LIKE @search OR a.serial_number LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND a.status = @status';
      params.push({ name: 'status', type: sql.VarChar(20), value: status });
    }

    if (category_id) {
      whereClause += ' AND p.category_id = @categoryId';
      params.push({ name: 'categoryId', type: sql.UniqueIdentifier, value: category_id });
    }

    if (location_id) {
      whereClause += ' AND u.location_id = @locationId';
      params.push({ name: 'locationId', type: sql.UniqueIdentifier, value: location_id });
    }

    if (assigned_to) {
      whereClause += ' AND a.assigned_to = @assignedTo';
      params.push({ name: 'assignedTo', type: sql.UniqueIdentifier, value: assigned_to });
    }

    if (reconciliation_status) {
      whereClause += ' AND rr.reconciliation_status = @reconciliationStatus';
      params.push({ name: 'reconciliationStatus', type: sql.VarChar(50), value: reconciliation_status });
    }

    if (department_id) {
      whereClause += ' AND u.department_id = @departmentId';
      params.push({ name: 'departmentId', type: sql.UniqueIdentifier, value: department_id });
    }

    // Build ORDER BY clause
    const validSortColumns = {
      asset_tag: 'a.asset_tag',
      product_name: 'p.name',
      status: 'a.status',
      created_at: 'a.created_at',
      reconciliation_status: 'rr.reconciliation_status'
    };
    const orderByColumn = validSortColumns[sortBy] || 'a.created_at';
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total records
    let countRequest = pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId);
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM assets a
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN RECONCILIATION_RECORDS rr ON rr.asset_id = a.id AND rr.reconciliation_id = @reconciliationId
      WHERE ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Fetch paginated data with reconciliation status
    let dataRequest = pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset);

    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT
        a.*,
        p.name as product_name,
        p.model as product_model,
        p.category_id,
        c.name as category_name,
        CONCAT(u.first_name, ' ', u.last_name) as assigned_user_name,
        u.email as assigned_user_email,
        d.department_name as department,
        CONCAT(
            l.name,
            CASE
                WHEN l.floor IS NOT NULL
                     AND LTRIM(RTRIM(CAST(l.floor AS VARCHAR(20)))) <> ''
                THEN ' - Floor ' + CAST(l.floor AS VARCHAR(20))
                ELSE ''
            END
        ) AS location_name,
        
        l.building AS location_building,
        l.floor AS location_floor,
        l.address AS location_address,
        -- Reconciliation record data
        rr.id as reconciliation_record_id,
        rr.reconciliation_status,
        rr.physical_location,
        rr.physical_condition,
        rr.physical_assigned_to,
        rr.discrepancy_notes,
        rr.reconciled_by,
        rr.reconciled_at,
        CONCAT(reconciler.first_name, ' ', reconciler.last_name) as reconciled_by_name,
        CASE WHEN rr.id IS NULL THEN 0 ELSE 1 END as is_reconciled
      FROM assets a
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      LEFT JOIN locations l ON a.location_id = l.id
      LEFT JOIN RECONCILIATION_RECORDS rr ON rr.asset_id = a.id AND rr.reconciliation_id = @reconciliationId
      LEFT JOIN USER_MASTER reconciler ON rr.reconciled_by = reconciler.user_id
      WHERE ${whereClause}
      ORDER BY ${orderByColumn} ${orderDirection}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    sendSuccess(res, {
      assets: result.recordset,
      pagination: getPaginationInfo(page, limit, total)
    }, 'Assets retrieved successfully');
  })
);

// ============================================================================
// ROUTE: POST /reconciliations/:id/assets/bulk
// Add multiple assets to reconciliation (creates pending records)
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.post('/bulk',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateBody(bulkAddAssetsSchema),
  asyncHandler(async (req, res) => {
    const { id: reconciliationId } = req.params;
    const { asset_ids } = req.body;

    const pool = await connectDB();

    // Verify reconciliation exists and is in correct status
    const reconciliationCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query('SELECT id, status FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (reconciliationCheck.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = reconciliationCheck.recordset[0];
    if (reconciliation.status === 'completed') {
      return sendError(res, 'Cannot add assets to a completed reconciliation', 400);
    }

    // Get current asset snapshot for each asset
    const transaction = pool.transaction();
    await transaction.begin();

    try {
      let addedCount = 0;
      let skippedCount = 0;

      for (const assetId of asset_ids) {
        // Check if asset exists
        const assetResult = await transaction.request()
          .input('assetId', sql.UniqueIdentifier, assetId)
          .query(`
            SELECT
              a.*,
              p.name as product_name,
              p.model as product_model,
              CONCAT(u.first_name, ' ', u.last_name) as assigned_user_name
            FROM assets a
            LEFT JOIN products p ON a.product_id = p.id
            LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
            WHERE a.id = @assetId AND a.is_active = 1
          `);

        if (assetResult.recordset.length === 0) {
          skippedCount++;
          continue;
        }

        const asset = assetResult.recordset[0];

        // Check if already added to this reconciliation
        const existingRecord = await transaction.request()
          .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
          .input('assetId', sql.UniqueIdentifier, assetId)
          .query(`
            SELECT id FROM RECONCILIATION_RECORDS
            WHERE reconciliation_id = @reconciliationId AND asset_id = @assetId
          `);

        if (existingRecord.recordset.length > 0) {
          skippedCount++;
          continue;
        }

        // Create system snapshot as JSON string
        const systemSnapshot = JSON.stringify({
          asset_tag: asset.asset_tag,
          serial_number: asset.serial_number,
          status: asset.status,
          condition_status: asset.condition_status,
          assigned_to: asset.assigned_to,
          assigned_user_name: asset.assigned_user_name,
          product_name: asset.product_name,
          product_model: asset.product_model,
          snapshot_time: new Date().toISOString()
        });

        // Insert reconciliation record
        const recordId = uuidv4();
        await transaction.request()
          .input('id', sql.UniqueIdentifier, recordId)
          .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
          .input('assetId', sql.UniqueIdentifier, assetId)
          .input('systemSnapshot', sql.NVarChar(sql.MAX), systemSnapshot)
          .query(`
            INSERT INTO RECONCILIATION_RECORDS (
              id, reconciliation_id, asset_id, reconciliation_status, system_snapshot
            )
            VALUES (
              @id, @reconciliationId, @assetId, 'pending', @systemSnapshot
            )
          `);

        addedCount++;
      }

      // Update total_assets count in reconciliation process
      await transaction.request()
        .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
        .query(`
          UPDATE RECONCILIATION_PROCESSES
          SET total_assets = (
            SELECT COUNT(*) FROM RECONCILIATION_RECORDS
            WHERE reconciliation_id = @reconciliationId
          )
          WHERE id = @reconciliationId
        `);

      await transaction.commit();

      sendSuccess(res, {
        added_count: addedCount,
        skipped_count: skippedCount,
        total_requested: asset_ids.length
      }, `Successfully added ${addedCount} assets to reconciliation`);

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// ============================================================================
// ROUTE: PUT /reconciliations/:id/assets/:assetId/reconcile
// Reconcile a single asset
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.put('/:assetId/reconcile',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('assetId'),
  validateBody(reconcileAssetSchema),
  asyncHandler(async (req, res) => {
    const { id: reconciliationId, assetId } = req.params;
    // const {
    //   reconciliation_status,
    //   physical_location,
    //   physical_condition,
    //   physical_assigned_to,
    //   physical_serial_number,
    //   physical_status,
    //   discrepancy_notes
    // } = req.body;
    const {
        reconciliation_status,
        physical_location,
        physical_condition,
        physical_assigned_to,
        physical_serial_number,
        physical_status,
        physical_department,
        discrepancy_notes
      } = req.body;
    const userId = req.user.id;

    const pool = await connectDB();

    // Verify reconciliation exists and is in progress
    const reconciliationCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query('SELECT id, status FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (reconciliationCheck.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = reconciliationCheck.recordset[0];
    if (reconciliation.status !== 'in_progress') {
      return sendError(res, 'Reconciliation must be in progress to reconcile assets', 400);
    }

    // Check if asset exists
    const assetCheck = await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query('SELECT id FROM assets WHERE id = @assetId AND is_active = 1');

    if (assetCheck.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    // Check if reconciliation record exists, create if not
    const recordCheck = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT id FROM RECONCILIATION_RECORDS
        WHERE reconciliation_id = @reconciliationId AND asset_id = @assetId
      `);

    let recordId;
    if (recordCheck.recordset.length === 0) {
      // Create new record
      recordId = uuidv4();

      // Get asset snapshot
      // const assetSnapshot = await pool.request()
      //   .input('assetId', sql.UniqueIdentifier, assetId)
      //   .query(`
      //     SELECT
      //         a.*,
      //         p.name as product_name,
      //         CONCAT(u.first_name, ' ', u.last_name) as assigned_user_name,
      //         d.department_name as department,
      //         CONCAT(
      //             l.name,
      //             CASE
      //                 WHEN l.floor IS NOT NULL
      //                 THEN ' - Floor ' + CAST(l.floor AS VARCHAR(20))
      //                 ELSE ''
      //             END
      //         ) as location_name
      //     FROM assets a
      //     LEFT JOIN products p ON a.product_id = p.id
      //     LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      //     LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
      //     LEFT JOIN LOCATIONS l ON a.location_id = l.id
      //     WHERE a.id = @assetId
      //   `);

      const assetSnapshot = await pool.request()
  .input('assetId', sql.UniqueIdentifier, assetId)
  .query(`
    SELECT
      a.*,
      p.name as product_name,
      CONCAT(u.first_name, ' ', u.last_name) as assigned_user_name,
      d.department_name as department,
      CONCAT(
    l.name,
    CASE
        WHEN l.floor IS NOT NULL
             AND LTRIM(RTRIM(CAST(l.floor AS VARCHAR(20)))) <> ''
        THEN ' - Floor ' + CAST(l.floor AS VARCHAR(20))
        ELSE ''
    END
) AS location_name
    FROM assets a
    LEFT JOIN products p ON a.product_id = p.id
    LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
    LEFT JOIN DEPARTMENT_MASTER d
      ON u.department_id = d.department_id
    LEFT JOIN LOCATIONS l
      ON a.location_id = l.id
    WHERE a.id = @assetId
  `);

      const asset = assetSnapshot.recordset[0];
      const systemSnapshot = JSON.stringify({
  asset_tag: asset.asset_tag,
  serial_number: asset.serial_number,
  status: asset.status,
  assigned_to: asset.assigned_to,
  assigned_user_name: asset.assigned_user_name,
  department: asset.department,
  location_name: asset.location_name,
  condition_status: asset.condition_status,
  product_name: asset.product_name,
  snapshot_time: new Date().toISOString()
});

console.log("ASSET SNAPSHOT:", asset);
console.log("SYSTEM SNAPSHOT:", systemSnapshot);
      await pool.request()
        .input('id', sql.UniqueIdentifier, recordId)
        .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
        .input('assetId', sql.UniqueIdentifier, assetId)
        .input('systemSnapshot', sql.NVarChar(sql.MAX), systemSnapshot)
        .query(`
          INSERT INTO RECONCILIATION_RECORDS (
            id, reconciliation_id, asset_id, system_snapshot
          )
          VALUES (@id, @reconciliationId, @assetId, @systemSnapshot)
        `);
    } else {
      recordId = recordCheck.recordset[0].id;
    }

    // Get the reconciliation record with system_snapshot
    const recordData = await pool.request()
      .input('id', sql.UniqueIdentifier, recordId)
      .query(`
        SELECT
          rr.*,
          a.asset_tag,
          a.serial_number,
          CONCAT(u.first_name, ' ', u.last_name) as assigned_user_name
        FROM RECONCILIATION_RECORDS rr
        LEFT JOIN assets a ON rr.asset_id = a.id
        LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
        WHERE rr.id = @id
      `);

    const record = recordData.recordset[0];
    const systemSnapshot = record.system_snapshot ? JSON.parse(record.system_snapshot) : {};
    console.log("SYSTEM SNAPSHOT FROM DB:", systemSnapshot);

    // Use transaction for atomic operations
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Update reconciliation record
      await transaction.request()
        .input('id', sql.UniqueIdentifier, recordId)
        .input('reconciliationStatus', sql.VarChar(50), reconciliation_status)
        .input('physicalLocation', sql.VarChar(255), physical_location || null)
        .input('physicalCondition', sql.VarChar(100), physical_condition || null)
        .input('physicalAssignedTo', sql.UniqueIdentifier, physical_assigned_to || null)
        .input('discrepancyNotes', sql.Text, discrepancy_notes || null)
        .input('reconciledBy', sql.UniqueIdentifier, userId)
        .query(`
          UPDATE RECONCILIATION_RECORDS
          SET
            reconciliation_status = @reconciliationStatus,
            physical_location = @physicalLocation,
            physical_condition = @physicalCondition,
            physical_assigned_to = @physicalAssignedTo,
            discrepancy_notes = @discrepancyNotes,
            reconciled_by = @reconciledBy,
            reconciled_at = GETUTCDATE(),
            updated_at = GETUTCDATE()
          WHERE id = @id
        `);

      // Detect and insert discrepancies
      // Fetch physical assigned user name if provided
      let physicalAssignedToName = null;
      if (physical_assigned_to) {
        const physicalUserResult = await transaction.request()
          .input('userId', sql.UniqueIdentifier, physical_assigned_to)
          .query(`
            SELECT CONCAT(first_name, ' ', last_name) as full_name
            FROM USER_MASTER
            WHERE user_id = @userId
          `);

        if (physicalUserResult.recordset.length > 0) {
          physicalAssignedToName = physicalUserResult.recordset[0].full_name;
        }
      }

      // const physicalValues = {
      //   physical_location,
      //   physical_condition,
      //   physical_assigned_to,
      //   physical_assigned_to_name: physicalAssignedToName,
      //   physical_serial_number,
      //   physical_status
      // };

      // const physicalValues = {
      //   physical_location,
      //   physical_condition,
      //   physical_assigned_to,
      //   physical_assigned_to_name: physicalAssignedToName,
      //   physical_serial_number,
      //   physical_status,
      //   physical_department
      // };

      const physicalValues = {
        physical_location,
        physical_condition,
        physical_assigned_to,
        physical_assigned_to_name: physicalAssignedToName,
        physical_serial_number,
        physical_status,
        physical_department
      };

      const assetData = {
        assigned_user_name: record.assigned_user_name
      };

      const detectedDiscrepancies = detectDiscrepancies(systemSnapshot, physicalValues, assetData);

      if (detectedDiscrepancies.length > 0) {
        await insertDiscrepancies(transaction, recordId, detectedDiscrepancies, userId);
      }

      // Update reconciliation process statistics
      await transaction.request()
        .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
        .query(`
          UPDATE RECONCILIATION_PROCESSES
          SET
            reconciled_assets = (
              SELECT COUNT(*)
              FROM RECONCILIATION_RECORDS
              WHERE reconciliation_id = @reconciliationId
                AND reconciliation_status != 'pending'
            ),
            discrepancy_count = (
              SELECT COUNT(*)
              FROM RECONCILIATION_RECORDS
              WHERE reconciliation_id = @reconciliationId
                AND reconciliation_status IN ('discrepancy', 'missing', 'damaged')
            )
          WHERE id = @reconciliationId
        `);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    // Fetch updated record with discrepancies
    const updatedRecord = await pool.request()
      .input('id', sql.UniqueIdentifier, recordId)
      .query(`
        SELECT
          rr.*,
          a.asset_tag,
          p.name as product_name,
          CONCAT(reconciler.first_name, ' ', reconciler.last_name) as reconciled_by_name,
          (SELECT COUNT(*) FROM RECONCILIATION_DISCREPANCIES WHERE reconciliation_record_id = rr.id) as discrepancy_count
        FROM RECONCILIATION_RECORDS rr
        LEFT JOIN assets a ON rr.asset_id = a.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN USER_MASTER reconciler ON rr.reconciled_by = reconciler.user_id
        WHERE rr.id = @id
      `);

    // Get discrepancies for this record
    const discrepanciesData = await pool.request()
      .input('recordId', sql.UniqueIdentifier, recordId)
      .query(`
        SELECT
          id, field_name, field_display_name, system_value, physical_value,
          discrepancy_type, severity, is_resolved
        FROM RECONCILIATION_DISCREPANCIES
        WHERE reconciliation_record_id = @recordId
        ORDER BY severity DESC, created_at ASC
      `);

    const responseData = {
      ...updatedRecord.recordset[0],
      discrepancies: discrepanciesData.recordset
    };

    sendSuccess(res, responseData, `Asset reconciled successfully${discrepanciesData.recordset.length > 0 ? ` with ${discrepanciesData.recordset.length} discrepancy(ies) detected` : ''}`);
  })
);

// ============================================================================
// ROUTE: POST /reconciliations/:id/assets/reconcile-bulk
// Bulk reconcile multiple assets with same status
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.post('/reconcile-bulk',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateBody(bulkReconcileSchema),
  asyncHandler(async (req, res) => {
    const { id: reconciliationId } = req.params;
    const {
      asset_ids,
      reconciliation_status,
      physical_location,
      physical_condition,
      physical_assigned_to,
      physical_serial_number,
      physical_status,
      discrepancy_notes
    } = req.body;

    // Note: Bulk reconciliation does not perform individual discrepancy detection
    // as all assets receive the same status and notes
    const userId = req.user.id;

    const pool = await connectDB();

    // Verify reconciliation exists and is in progress
    const reconciliationCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query('SELECT id, status FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (reconciliationCheck.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = reconciliationCheck.recordset[0];
    if (reconciliation.status !== 'in_progress') {
      return sendError(res, 'Reconciliation must be in progress to reconcile assets', 400);
    }

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      let reconciledCount = 0;

      for (const assetId of asset_ids) {
        // Check if record exists
        const recordCheck = await transaction.request()
          .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
          .input('assetId', sql.UniqueIdentifier, assetId)
          .query(`
            SELECT id FROM RECONCILIATION_RECORDS
            WHERE reconciliation_id = @reconciliationId AND asset_id = @assetId
          `);

        let recordId;
        if (recordCheck.recordset.length === 0) {
          // Create new record with snapshot
          recordId = uuidv4();

          const assetSnapshot = await transaction.request()
            .input('assetId', sql.UniqueIdentifier, assetId)
            .query(`
              SELECT a.*, p.name as product_name
              FROM assets a
              LEFT JOIN products p ON a.product_id = p.id
              WHERE a.id = @assetId AND a.is_active = 1
            `);

          if (assetSnapshot.recordset.length === 0) continue;

          const asset = assetSnapshot.recordset[0];
          const systemSnapshot = JSON.stringify({
            asset_tag: asset.asset_tag,
            status: asset.status,
            snapshot_time: new Date().toISOString()
          });

          await transaction.request()
            .input('id', sql.UniqueIdentifier, recordId)
            .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
            .input('assetId', sql.UniqueIdentifier, assetId)
            .input('systemSnapshot', sql.NVarChar(sql.MAX), systemSnapshot)
            .query(`
              INSERT INTO RECONCILIATION_RECORDS (
                id, reconciliation_id, asset_id, system_snapshot
              )
              VALUES (@id, @reconciliationId, @assetId, @systemSnapshot)
            `);
        } else {
          recordId = recordCheck.recordset[0].id;
        }

        // Update record
        await transaction.request()
          .input('id', sql.UniqueIdentifier, recordId)
          .input('reconciliationStatus', sql.VarChar(50), reconciliation_status)
          .input('physicalLocation', sql.VarChar(255), physical_location || null)
          .input('physicalCondition', sql.VarChar(100), physical_condition || null)
          .input('physicalAssignedTo', sql.UniqueIdentifier, physical_assigned_to || null)
          .input('discrepancyNotes', sql.Text, discrepancy_notes || null)
          .input('reconciledBy', sql.UniqueIdentifier, userId)
          .query(`
            UPDATE RECONCILIATION_RECORDS
            SET
              reconciliation_status = @reconciliationStatus,
              physical_location = @physicalLocation,
              physical_condition = @physicalCondition,
              physical_assigned_to = @physicalAssignedTo,
              discrepancy_notes = @discrepancyNotes,
              reconciled_by = @reconciledBy,
              reconciled_at = GETUTCDATE(),
              updated_at = GETUTCDATE()
            WHERE id = @id
          `);

        reconciledCount++;
      }

      // Update process statistics
      await transaction.request()
        .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
        .query(`
          UPDATE RECONCILIATION_PROCESSES
          SET
            reconciled_assets = (
              SELECT COUNT(*)
              FROM RECONCILIATION_RECORDS
              WHERE reconciliation_id = @reconciliationId
                AND reconciliation_status != 'pending'
            ),
            discrepancy_count = (
              SELECT COUNT(*)
              FROM RECONCILIATION_RECORDS
              WHERE reconciliation_id = @reconciliationId
                AND reconciliation_status IN ('discrepancy', 'missing', 'damaged')
            )
          WHERE id = @reconciliationId
        `);

      await transaction.commit();

      sendSuccess(res, {
        reconciled_count: reconciledCount,
        total_requested: asset_ids.length
      }, `Successfully reconciled ${reconciledCount} assets`);

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

module.exports = router;
