const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');

const { connectDB, sql } = require('../../config/database');
const { validateBody, validateParams, validateQuery, validatePagination, validateUUID } = require('../../middleware/validation');
const { requireRole } = require('../../middleware/permissions');
const { authenticateToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } = require('../../utils/response');
const { getPaginationInfo } = require('../../utils/helpers');
const { roles: USER_ROLES } = require('../../config/auth');

const router = express.Router();

// Import sub-routes
const assetsRoutes = require('./assets');
const discrepanciesRoutes = require('./discrepancies');

// Apply authentication to all routes
router.use(authenticateToken);

// Mount sub-routes - MUST be before /:id routes to avoid conflicts
router.use('/:id/assets', assetsRoutes);
router.use('/:id/discrepancies', discrepanciesRoutes);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createReconciliationSchema = Joi.object({
  reconciliation_name: Joi.string().min(3).max(255).required(),
  description: Joi.string().max(5000).allow(null, '').optional(),
  notes: Joi.string().max(5000).allow(null, '').optional()
});

const startReconciliationSchema = Joi.object({
  notes: Joi.string().max(5000).allow(null, '').optional()
});

const completeReconciliationSchema = Joi.object({
  notes: Joi.string().max(5000).allow(null, '').optional(),
  force: Joi.boolean().optional()
});

const pauseReconciliationSchema = Joi.object({
  notes: Joi.string().max(5000).allow(null, '').optional()
});

const resumeReconciliationSchema = Joi.object({
  notes: Joi.string().max(5000).allow(null, '').optional()
});

// ============================================================================
// ROUTE: POST /reconciliations
// Create new reconciliation process
// Access: Admin, SuperAdmin only
// ============================================================================
router.post('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR]),
  validateBody(createReconciliationSchema),
  asyncHandler(async (req, res) => {
    const { reconciliation_name, description, notes } = req.body;
    const userId = req.user.id;

    const pool = await connectDB();

    // Check for duplicate name
    const existingCheck = await pool.request()
      .input('name', sql.VarChar(255), reconciliation_name)
      .query('SELECT id FROM RECONCILIATION_PROCESSES WHERE reconciliation_name = @name AND is_active = 1');

    if (existingCheck.recordset.length > 0) {
      return sendError(res, 'A reconciliation process with this name already exists', 409);
    }

    const reconciliationId = uuidv4();

    await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .input('reconciliation_name', sql.VarChar(255), reconciliation_name)
      .input('description', sql.Text, description || null)
      .input('notes', sql.Text, notes || null)
      .input('created_by', sql.UniqueIdentifier, userId)
      .query(`
        INSERT INTO RECONCILIATION_PROCESSES (
          id, reconciliation_name, description, notes, created_by, status
        )
        VALUES (
          @id, @reconciliation_name, @description, @notes, @created_by, 'draft'
        )
      `);

    // Fetch the created reconciliation with creator details
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query(`
        SELECT
          rp.*,
          CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
          u.email as created_by_email
        FROM RECONCILIATION_PROCESSES rp
        LEFT JOIN USER_MASTER u ON rp.created_by = u.user_id
        WHERE rp.id = @id
      `);

    sendCreated(res, result.recordset[0], 'Reconciliation process created successfully');
  })
);

// ============================================================================
// ROUTE: GET /reconciliations
// List all reconciliation processes with pagination and filters
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { page, limit, offset, sortBy, sortOrder } = req.pagination;
    const { search, status, created_by } = req.query;

    const pool = await connectDB();

    // Build WHERE clause
    let whereClause = 'rp.is_active = 1';
    const params = [];

    if (search) {
      whereClause += ' AND (rp.reconciliation_name LIKE @search OR rp.description LIKE @search)';
      params.push({ name: 'search', type: sql.VarChar(255), value: `%${search}%` });
    }

    if (status) {
      whereClause += ' AND rp.status = @status';
      params.push({ name: 'status', type: sql.VarChar(50), value: status });
    }

    if (created_by) {
      whereClause += ' AND rp.created_by = @createdBy';
      params.push({ name: 'createdBy', type: sql.UniqueIdentifier, value: created_by });
    }

    // Build ORDER BY clause
    const validSortColumns = {
      created_at: 'rp.created_at',
      reconciliation_name: 'rp.reconciliation_name',
      status: 'rp.status',
      total_assets: 'rp.total_assets',
      reconciled_assets: 'rp.reconciled_assets'
    };
    const orderByColumn = validSortColumns[sortBy] || 'rp.created_at';
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total records
    let countRequest = pool.request();
    params.forEach(param => countRequest.input(param.name, param.type, param.value));

    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total
      FROM RECONCILIATION_PROCESSES rp
      WHERE ${whereClause}
    `);
    const total = countResult.recordset[0].total;

    // Fetch paginated data
    let dataRequest = pool.request()
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset);

    params.forEach(param => dataRequest.input(param.name, param.type, param.value));

    const result = await dataRequest.query(`
      SELECT
        rp.*,
        CONCAT(creator.first_name, ' ', creator.last_name) as created_by_name,
        creator.email as created_by_email,
        CONCAT(starter.first_name, ' ', starter.last_name) as started_by_name,
        starter.email as started_by_email
      FROM RECONCILIATION_PROCESSES rp
      LEFT JOIN USER_MASTER creator ON rp.created_by = creator.user_id
      LEFT JOIN USER_MASTER starter ON rp.started_by = starter.user_id
      WHERE ${whereClause}
      ORDER BY ${orderByColumn} ${orderDirection}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    sendSuccess(res, {
      reconciliations: result.recordset,
      pagination: getPaginationInfo(page, limit, total)
    }, 'Reconciliation processes retrieved successfully');
  })
);

// ============================================================================
// ROUTE: GET /reconciliations/:id/statistics
// Get reconciliation statistics
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/:id/statistics',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id: reconciliationId } = req.params;

    const pool = await connectDB();

    // Verify reconciliation exists
    const reconciliationCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, reconciliationId)
      .query('SELECT * FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (reconciliationCheck.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = reconciliationCheck.recordset[0];

    // Get detailed statistics
    const statsResult = await pool.request()
      .input('reconciliationId', sql.UniqueIdentifier, reconciliationId)
      .query(`
        SELECT
          COUNT(*) as total_assets,
          SUM(CASE WHEN reconciliation_status != 'pending' THEN 1 ELSE 0 END) as reconciled_assets,
          SUM(CASE WHEN reconciliation_status = 'pending' THEN 1 ELSE 0 END) as pending_assets,
          SUM(CASE WHEN reconciliation_status = 'verified' THEN 1 ELSE 0 END) as verified_assets,
          SUM(CASE WHEN reconciliation_status = 'discrepancy' THEN 1 ELSE 0 END) as discrepancy_assets,
          SUM(CASE WHEN reconciliation_status = 'missing' THEN 1 ELSE 0 END) as missing_assets,
          SUM(CASE WHEN reconciliation_status = 'damaged' THEN 1 ELSE 0 END) as damaged_assets
        FROM RECONCILIATION_RECORDS
        WHERE reconciliation_id = @reconciliationId
      `);

    const stats = statsResult.recordset[0];

    // Calculate progress percentage
    const progressPercentage = stats.total_assets > 0
      ? Math.round((stats.reconciled_assets / stats.total_assets) * 100)
      : 0;

    sendSuccess(res, {
      reconciliation: {
        id: reconciliation.id,
        name: reconciliation.reconciliation_name,
        status: reconciliation.status,
        created_at: reconciliation.created_at,
        started_at: reconciliation.started_at,
        completed_at: reconciliation.completed_at
      },
      statistics: {
        total_assets: stats.total_assets || 0,
        reconciled_assets: stats.reconciled_assets || 0,
        pending_assets: stats.pending_assets || 0,
        verified_assets: stats.verified_assets || 0,
        discrepancy_assets: stats.discrepancy_assets || 0,
        missing_assets: stats.missing_assets || 0,
        damaged_assets: stats.damaged_assets || 0,
        progress_percentage: progressPercentage
      }
    }, 'Statistics retrieved successfully');
  })
);

// ============================================================================
// ROUTE: GET /reconciliations/:id
// Get single reconciliation process by ID
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.get('/:id',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          rp.*,
          CONCAT(creator.first_name, ' ', creator.last_name) as created_by_name,
          creator.email as created_by_email,
          CONCAT(starter.first_name, ' ', starter.last_name) as started_by_name,
          starter.email as started_by_email
        FROM RECONCILIATION_PROCESSES rp
        LEFT JOIN USER_MASTER creator ON rp.created_by = creator.user_id
        LEFT JOIN USER_MASTER starter ON rp.started_by = starter.user_id
        WHERE rp.id = @id AND rp.is_active = 1
      `);

    if (result.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    sendSuccess(res, result.recordset[0], 'Reconciliation process retrieved successfully');
  })
);

// ============================================================================
// ROUTE: PUT /reconciliations/:id/start
// Start a reconciliation process (change status from draft to in_progress)
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.put('/:id/start',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('id'),
  validateBody(startReconciliationSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;

    const pool = await connectDB();

    // Check if reconciliation exists and is in draft status
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, status FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = existing.recordset[0];
    if (reconciliation.status !== 'draft') {
      return sendError(res, `Cannot start reconciliation. Current status: ${reconciliation.status}`, 400);
    }

    // Use transaction to ensure data consistency
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Update status to in_progress
      await transaction.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('started_by', sql.UniqueIdentifier, userId)
        .input('notes', sql.Text, notes || null)
        .query(`
          UPDATE RECONCILIATION_PROCESSES
          SET
            status = 'in_progress',
            started_by = @started_by,
            started_at = GETUTCDATE(),
            notes = CASE WHEN @notes IS NOT NULL THEN @notes ELSE notes END
          WHERE id = @id
        `);

      // Get all active assets with their current state
      // const assetsResult = await transaction.request()
      //   .query(`
      //     SELECT
      //       a.id as asset_id,
      //       a.asset_tag,
      //       a.status,
      //       a.assigned_to,
      //       a.condition_status,
      //       u.location_id,
      //       l.name as location_name
      //     FROM assets a
      //     LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      //     LEFT JOIN locations l ON u.location_id = l.id
      //     WHERE a.is_active = 1
      //   `);

      const assetsResult = await transaction.request()
        .query(`
          SELECT
            a.id AS asset_id,
            a.asset_tag,
            a.status,
            a.assigned_to,
            a.condition_status,
            a.location_id,
            l.name AS location_name,
            l.floor AS floor
        FROM assets a
        LEFT JOIN locations l
            ON a.location_id = l.id
        WHERE a.is_active = 1
        `);

      const assets = assetsResult.recordset;

      // Create reconciliation records for all active assets in batches
      if (assets.length > 0) {
        const batchSize = 500; // Process 500 assets at a time to avoid parameter limit

        for (let i = 0; i < assets.length; i += batchSize) {
          const batch = assets.slice(i, i + batchSize);

          // Build bulk insert query for this batch
          const values = batch.map((asset, index) => {
            return `(
              NEWID(),
              @reconciliationId,
              @assetId${index},
              'pending',
              @systemSnapshot${index},
              GETUTCDATE(),
              GETUTCDATE()
            )`;
          }).join(',');

          const insertRequest = transaction.request()
            .input('reconciliationId', sql.UniqueIdentifier, id);

          // Add parameters for each asset in this batch
          batch.forEach((asset, index) => {
            insertRequest.input(`assetId${index}`, sql.UniqueIdentifier, asset.asset_id);

            // Create system snapshot JSON
            // const snapshot = {
            //   asset_tag: asset.asset_tag,
            //   status: asset.status,
            //   assigned_to: asset.assigned_to,
            //   location_id: asset.location_id,
            //   location_name: asset.location_name,
            //   condition_status: asset.condition_status
            // };
            // const snapshot = {
            //   asset_tag: asset.asset_tag,
            //   status: asset.status,
            //   assigned_to: asset.assigned_to,
            //   location_id: asset.location_id,
            //   location_name: asset.location_name,
            //   floor: asset.floor,
            //   condition_status: asset.condition_status
            // };
            const snapshot = {
            asset_tag: asset.asset_tag,
            status: asset.status,
            assigned_to: asset.assigned_to,
            location_id: asset.location_id,
          
            location_name: asset.location_name
              ? `${asset.location_name}${
                  asset.floor !== null &&
                  asset.floor !== undefined &&
                  String(asset.floor).trim() !== ''
                    ? ` - Floor ${asset.floor}`
                    : ''
                }`
              : null,
          
            floor: asset.floor,
            condition_status: asset.condition_status
          };
            console.log("SNAPSHOT TO SAVE:", snapshot);
            insertRequest.input(`systemSnapshot${index}`, sql.NVarChar(sql.MAX), JSON.stringify(snapshot));
          });

          await insertRequest.query(`
            INSERT INTO RECONCILIATION_RECORDS (
              id,
              reconciliation_id,
              asset_id,
              reconciliation_status,
              system_snapshot,
              created_at,
              updated_at
            )
            VALUES ${values}
          `);
        }
      }

      // Update total_assets count in reconciliation process
      await transaction.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('totalAssets', sql.Int, assets.length)
        .query(`
          UPDATE RECONCILIATION_PROCESSES
          SET total_assets = @totalAssets
          WHERE id = @id
        `);

      await transaction.commit();

      // Fetch updated reconciliation
      const result = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`
          SELECT
            rp.*,
            CONCAT(creator.first_name, ' ', creator.last_name) as created_by_name,
            creator.email as created_by_email,
            CONCAT(starter.first_name, ' ', starter.last_name) as started_by_name,
            starter.email as started_by_email
          FROM RECONCILIATION_PROCESSES rp
          LEFT JOIN USER_MASTER creator ON rp.created_by = creator.user_id
          LEFT JOIN USER_MASTER starter ON rp.started_by = starter.user_id
          WHERE rp.id = @id
        `);

      sendSuccess(res, result.recordset[0], `Reconciliation process started successfully with ${assets.length} assets`);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);

// ============================================================================
// ROUTE: PUT /reconciliations/:id/complete
// Mark reconciliation as completed
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.put('/:id/complete',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('id'),
  validateBody(completeReconciliationSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { notes, force } = req.body;

    const pool = await connectDB();

    // Check if reconciliation exists
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, status FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = existing.recordset[0];
    if (reconciliation.status === 'completed') {
      return sendError(res, 'Reconciliation is already completed', 400);
    }

    if (reconciliation.status === 'draft') {
      return sendError(res, 'Cannot complete a reconciliation that has not been started', 400);
    }

    // Check if all assets have been reconciled
    const pendingCheck = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT COUNT(*) as pending_count
        FROM RECONCILIATION_RECORDS
        WHERE reconciliation_id = @id AND reconciliation_status = 'pending'
      `);

    const pendingCount = pendingCheck.recordset[0].pending_count;

    // If there are pending assets and force is not true, return error
    if (pendingCount > 0 && !force) {
      return sendError(res, `Cannot complete reconciliation. ${pendingCount} asset(s) are still pending reconciliation. Use force=true to complete anyway.`, 400);
    }

    // Get reconciliation statistics for final update
    const statsResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          COUNT(*) as total_assets,
          SUM(CASE WHEN reconciliation_status != 'pending' THEN 1 ELSE 0 END) as reconciled_assets
        FROM RECONCILIATION_RECORDS
        WHERE reconciliation_id = @id
      `);

    const stats = statsResult.recordset[0];

    // Update status to completed with final counts
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('notes', sql.Text, notes || null)
      .input('totalAssets', sql.Int, stats.total_assets || 0)
      .input('reconciledAssets', sql.Int, stats.reconciled_assets || 0)
      .input('forcedCompletion', sql.Bit, force ? 1 : 0)
      .input('pendingAtCompletion', sql.Int, pendingCount)
      .query(`
        UPDATE RECONCILIATION_PROCESSES
        SET
          status = 'completed',
          completed_at = GETUTCDATE(),
          notes = CASE WHEN @notes IS NOT NULL THEN @notes ELSE notes END,
          total_assets = @totalAssets,
          reconciled_assets = @reconciledAssets,
          forced_completion = @forcedCompletion,
          pending_at_completion = @pendingAtCompletion
        WHERE id = @id
      `);

    // Fetch updated reconciliation
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          rp.*,
          CONCAT(creator.first_name, ' ', creator.last_name) as created_by_name,
          creator.email as created_by_email,
          CONCAT(starter.first_name, ' ', starter.last_name) as started_by_name,
          starter.email as started_by_email
        FROM RECONCILIATION_PROCESSES rp
        LEFT JOIN USER_MASTER creator ON rp.created_by = creator.user_id
        LEFT JOIN USER_MASTER starter ON rp.started_by = starter.user_id
        WHERE rp.id = @id
      `);

    sendSuccess(res, result.recordset[0], 'Reconciliation process completed successfully');
  })
);

// ============================================================================
// ROUTE: PUT /reconciliations/:id/pause
// Pause a reconciliation process (change status from in_progress to paused)
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.put('/:id/pause',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('id'),
  validateBody(pauseReconciliationSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;

    const pool = await connectDB();

    // Check if reconciliation exists and is in progress
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, status, pause_count FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = existing.recordset[0];
    if (reconciliation.status !== 'in_progress') {
      return sendError(res, `Cannot pause reconciliation. Current status: ${reconciliation.status}. Only in_progress reconciliations can be paused.`, 400);
    }

    // Update status to paused
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('pausedBy', sql.UniqueIdentifier, userId)
      .input('pauseCount', sql.Int, (reconciliation.pause_count || 0) + 1)
      .input('notes', sql.Text, notes || null)
      .query(`
        UPDATE RECONCILIATION_PROCESSES
        SET
          status = 'paused',
          paused_by = @pausedBy,
          paused_at = GETUTCDATE(),
          pause_count = @pauseCount,
          notes = CASE WHEN @notes IS NOT NULL THEN @notes ELSE notes END
        WHERE id = @id
      `);

    // Fetch updated reconciliation
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          rp.*,
          CONCAT(creator.first_name, ' ', creator.last_name) as created_by_name,
          creator.email as created_by_email,
          CONCAT(starter.first_name, ' ', starter.last_name) as started_by_name,
          starter.email as started_by_email,
          CONCAT(pauser.first_name, ' ', pauser.last_name) as paused_by_name,
          pauser.email as paused_by_email
        FROM RECONCILIATION_PROCESSES rp
        LEFT JOIN USER_MASTER creator ON rp.created_by = creator.user_id
        LEFT JOIN USER_MASTER starter ON rp.started_by = starter.user_id
        LEFT JOIN USER_MASTER pauser ON rp.paused_by = pauser.user_id
        WHERE rp.id = @id
      `);

    sendSuccess(res, result.recordset[0], 'Reconciliation process paused successfully');
  })
);

// ============================================================================
// ROUTE: PUT /reconciliations/:id/resume
// Resume a paused reconciliation process (change status from paused to in_progress)
// Access: Admin, SuperAdmin, Engineer
// ============================================================================
router.put('/:id/resume',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.ENGINEER, USER_ROLES.COORDINATOR]),
  validateUUID('id'),
  validateBody(resumeReconciliationSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;

    const pool = await connectDB();

    // Check if reconciliation exists and is paused
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id, status FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    const reconciliation = existing.recordset[0];
    if (reconciliation.status !== 'paused') {
      return sendError(res, `Cannot resume reconciliation. Current status: ${reconciliation.status}. Only paused reconciliations can be resumed.`, 400);
    }

    // Update status to in_progress
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('resumedBy', sql.UniqueIdentifier, userId)
      .input('notes', sql.Text, notes || null)
      .query(`
        UPDATE RECONCILIATION_PROCESSES
        SET
          status = 'in_progress',
          resumed_by = @resumedBy,
          resumed_at = GETUTCDATE(),
          notes = CASE WHEN @notes IS NOT NULL THEN @notes ELSE notes END
        WHERE id = @id
      `);

    // Fetch updated reconciliation
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          rp.*,
          CONCAT(creator.first_name, ' ', creator.last_name) as created_by_name,
          creator.email as created_by_email,
          CONCAT(starter.first_name, ' ', starter.last_name) as started_by_name,
          starter.email as started_by_email,
          CONCAT(resumer.first_name, ' ', resumer.last_name) as resumed_by_name,
          resumer.email as resumed_by_email
        FROM RECONCILIATION_PROCESSES rp
        LEFT JOIN USER_MASTER creator ON rp.created_by = creator.user_id
        LEFT JOIN USER_MASTER starter ON rp.started_by = starter.user_id
        LEFT JOIN USER_MASTER resumer ON rp.resumed_by = resumer.user_id
        WHERE rp.id = @id
      `);

    sendSuccess(res, result.recordset[0], 'Reconciliation process resumed successfully');
  })
);

// ============================================================================
// ROUTE: DELETE /reconciliations/:id
// Delete (soft delete) a reconciliation process
// Access: Admin, SuperAdmin only
// ============================================================================
router.delete('/:id',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR]),
  validateUUID('id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pool = await connectDB();

    // Check if reconciliation exists
    const existing = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM RECONCILIATION_PROCESSES WHERE id = @id AND is_active = 1');

    if (existing.recordset.length === 0) {
      return sendNotFound(res, 'Reconciliation process not found');
    }

    // Soft delete
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('UPDATE RECONCILIATION_PROCESSES SET is_active = 0 WHERE id = @id');

    sendSuccess(res, null, 'Reconciliation process deleted successfully');
  })
);

module.exports = router;
