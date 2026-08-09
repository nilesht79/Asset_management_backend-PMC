/**
 * Standby Asset Pool Management Controller
 * Handles all operations related to standby asset pool
 */

const { connectDB, sql } = require('../config/database');
const { sendSuccess, sendCreated, sendError, sendNotFound } = require('../utils/response');

/**
 * Get all standby assets with filters
 * GET /api/v1/standby-assets
 */
const getStandbyAssets = async (req, res) => {
  try {
    const {
      status,
      availability,
      category_id,
      product_type_id,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const pool = await connectDB();
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereConditions = ['a.is_active = 1', 'a.is_standby_asset = 1'];

    if (status) {
      whereConditions.push('a.status = @status');
    }

    if (availability === 'available') {
      whereConditions.push('a.standby_available = 1');
      whereConditions.push('a.assigned_to IS NULL');
    } else if (availability === 'assigned') {
      whereConditions.push('a.standby_available = 0');
      whereConditions.push('a.assigned_to IS NOT NULL');
    }

    if (category_id) {
      whereConditions.push('p.category_id = @categoryId');
    }

    if (product_type_id) {
      whereConditions.push('p.type_id = @productTypeId');
    }

    if (search) {
      whereConditions.push('(a.asset_tag LIKE @search OR a.serial_number LIKE @search OR p.name LIKE @search)');
    }

    const whereClause = whereConditions.join(' AND ');

    // Build query
    const request = pool.request()
      .input('limit', sql.Int, parseInt(limit))
      .input('offset', sql.Int, offset);

    if (status) request.input('status', sql.VarChar(50), status);
    if (category_id) request.input('categoryId', sql.UniqueIdentifier, category_id);
    if (product_type_id) request.input('productTypeId', sql.UniqueIdentifier, product_type_id);
    if (search) request.input('search', sql.VarChar(100), `%${search}%`);

    // Get total count
    const countResult = await request.query(`
      SELECT COUNT(*) as total
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get standby assets
    const result = await request.query(`
      SELECT
        a.id,
        a.asset_tag,
        a.serial_number,
        a.status,
        a.condition_status,
        a.is_standby_asset,
        a.standby_available,
        a.assigned_to,
        a.purchase_date,
        a.warranty_end_date,
        a.purchase_cost,
        a.created_at,
        a.updated_at,
        p.id as product_id,
        p.name as product_name,
        p.model as product_model,
        p.capacity_value,
        p.capacity_unit,
        p.speed_value,
        p.speed_unit,
        pt.name as product_type,
        cat.name as category_name,
        o.name as oem_name,
        u.first_name + ' ' + u.last_name as assigned_to_name,
        u.email as assigned_to_email,
        (
          SELECT TOP 1
                sa.id,
                sa.user_id,
                um.first_name + ' ' + um.last_name AS name,
                sa.assigned_date,
                sa.reason,
                sa.notes
            FROM STANDBY_ASSIGNMENTS sa
            INNER JOIN USER_MASTER um
                ON sa.user_id = um.user_id
            WHERE sa.standby_asset_id = a.id
              AND sa.status = 'active'
            ORDER BY sa.assigned_date DESC
            FOR JSON PATH
        ) AS current_assignment
      FROM assets a
      INNER JOIN products p ON a.product_id = p.id
      LEFT JOIN product_types pt ON p.type_id = pt.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN oems o ON p.oem_id = o.id
      LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

   // Parse JSON assignments
const assets = result.recordset.map(asset => {

  let assignment = null;

  if (asset.current_assignment) {
    try {
      const arr = JSON.parse(asset.current_assignment);
      assignment = arr.length > 0 ? arr[0] : null;
    } catch (e) {
      assignment = null;
    }
  }

  return {
    ...asset,
    current_assignment: assignment
  };

});

    // Get statistics
    const statsResult = await pool.request().query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN standby_available = 1 AND assigned_to IS NULL THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN standby_available = 0 AND assigned_to IS NOT NULL THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as under_repair
      FROM assets
      WHERE is_active = 1 AND is_standby_asset = 1
    `);

    return sendSuccess(res, {
      assets,
      statistics: statsResult.recordset[0],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    }, 'Standby assets retrieved successfully');

  } catch (error) {
    console.error('Error fetching standby assets:', error);
    return sendError(res, 'Failed to fetch standby assets', 500);
  }
};

/**
 * Add asset to standby pool
 * POST /api/v1/standby-assets/:id/add
 */
const addToStandbyPool = async (req, res) => {
  try {
    const { id: assetId } = req.params;
    const performedBy = req.user?.id;

    const pool = await connectDB();

    // Check if asset exists and is not already in standby pool
    const assetCheck = await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT id, asset_tag, is_standby_asset, assigned_to, status, asset_type
        FROM assets
        WHERE id = @assetId AND is_active = 1
      `);

    if (assetCheck.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    const asset = assetCheck.recordset[0];

    // Validation: Cannot add component to standby pool
    if (asset.asset_type === 'component') {
      return sendError(res, 'Components cannot be added to standby pool', 400);
    }

    // Validation: Cannot add assigned asset to standby pool
    if (asset.assigned_to) {
      return sendError(res, 'Cannot add assigned asset to standby pool. Unassign it first.', 400);
    }

    // Check if already in standby pool
    if (asset.is_standby_asset) {
      return sendError(res, 'Asset is already in standby pool', 400);
    }

    // Add to standby pool
    await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        UPDATE assets
        SET is_standby_asset = 1,
            standby_available = 1,
            status = 'available',
            updated_at = GETUTCDATE()
        WHERE id = @assetId
      `);

    // Log movement
    await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .input('assetTag', sql.VarChar(50), asset.asset_tag)
      .input('movementType', sql.VarChar(20), 'available')
      .input('status', sql.VarChar(20), 'available')
      .input('reason', sql.Text, 'Added to standby pool')
      .input('performedBy', sql.UniqueIdentifier, performedBy)
      .input('performedByName', sql.NVarChar(200), `${req.user.firstName} ${req.user.lastName}`)
      .query(`
        INSERT INTO ASSET_MOVEMENTS (
          asset_id, asset_tag, movement_type, status,
          reason, performed_by, performed_by_name, movement_date, created_at
        )
        VALUES (
          @assetId, @assetTag, @movementType, @status,
          @reason, @performedBy, @performedByName, GETUTCDATE(), GETUTCDATE()
        )
      `);

    return sendSuccess(res, {
      asset_id: assetId,
      asset_tag: asset.asset_tag
    }, 'Asset added to standby pool successfully');

  } catch (error) {
    console.error('Error adding asset to standby pool:', error);
    return sendError(res, 'Failed to add asset to standby pool', 500);
  }
};

/**
 * Remove asset from standby pool
 * DELETE /api/v1/standby-assets/:id/remove
 */
const removeFromStandbyPool = async (req, res) => {
  try {
    const { id: assetId } = req.params;
    const performedBy = req.user?.id;

    const pool = await connectDB();

    // Check if asset exists and is in standby pool
    const assetCheck = await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT id, asset_tag, is_standby_asset, assigned_to
        FROM assets
        WHERE id = @assetId AND is_active = 1
      `);

    if (assetCheck.recordset.length === 0) {
      return sendNotFound(res, 'Asset not found');
    }

    const asset = assetCheck.recordset[0];

    // Check if in standby pool
    if (!asset.is_standby_asset) {
      return sendError(res, 'Asset is not in standby pool', 400);
    }

    // Check if currently assigned
    if (asset.assigned_to) {
      return sendError(res, 'Cannot remove assigned standby asset. Return it first.', 400);
    }

    // Check if has active assignments
    const activeAssignmentCheck = await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT COUNT(*) as count
        FROM STANDBY_ASSIGNMENTS
        WHERE standby_asset_id = @assetId AND status = 'active'
      `);

    if (activeAssignmentCheck.recordset[0].count > 0) {
      return sendError(res, 'Cannot remove asset with active assignments', 400);
    }

    // Remove from standby pool
    await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        UPDATE assets
        SET is_standby_asset = 0,
            standby_available = 1,
            updated_at = GETUTCDATE()
        WHERE id = @assetId
      `);

    // Log movement
    await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .input('assetTag', sql.VarChar(50), asset.asset_tag)
      .input('movementType', sql.VarChar(20), 'available')
      .input('status', sql.VarChar(20), 'available')
      .input('reason', sql.Text, 'Removed from standby pool')
      .input('performedBy', sql.UniqueIdentifier, performedBy)
      .input('performedByName', sql.NVarChar(200), `${req.user.firstName} ${req.user.lastName}`)
      .query(`
        INSERT INTO ASSET_MOVEMENTS (
          asset_id, asset_tag, movement_type, status,
          reason, performed_by, performed_by_name, movement_date, created_at
        )
        VALUES (
          @assetId, @assetTag, @movementType, @status,
          @reason, @performedBy, @performedByName, GETUTCDATE(), GETUTCDATE()
        )
      `);

    return sendSuccess(res, {
      asset_id: assetId,
      asset_tag: asset.asset_tag
    }, 'Asset removed from standby pool successfully');

  } catch (error) {
    console.error('Error removing asset from standby pool:', error);
    return sendError(res, 'Failed to remove asset from standby pool', 500);
  }
};

/**
 * Get standby pool statistics
 * GET /api/v1/standby-assets/statistics
 */
const getStandbyStatistics = async (req, res) => {
  try {
    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN standby_available = 1 AND assigned_to IS NULL THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN standby_available = 0 AND assigned_to IS NOT NULL THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as under_repair,
        SUM(CASE WHEN status = 'retired' THEN 1 ELSE 0 END) as retired
      FROM assets
      WHERE is_active = 1 AND is_standby_asset = 1
    `);

    return sendSuccess(res, result.recordset[0], 'Standby statistics retrieved successfully');

  } catch (error) {
    console.error('Error fetching standby statistics:', error);
    return sendError(res, 'Failed to fetch standby statistics', 500);
  }
};

module.exports = {
  getStandbyAssets,
  addToStandbyPool,
  removeFromStandbyPool,
  getStandbyStatistics
};
