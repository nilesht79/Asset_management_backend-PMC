/**
 * Standby Assignment Controller
 * Handles temporary standby asset assignments to users
 */

const { connectDB, sql } = require('../config/database');
const { sendSuccess, sendCreated, sendError, sendNotFound } = require('../utils/response');
const { getUserFullName } = require('../utils/userHelpers');

/**
 * Get all standby assignments with filters
 * GET /api/v1/standby-assignments
 */
const getStandbyAssignments = async (req, res) => {
  try {
    const {
      status,
      user_id,
      reason_category,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const pool = await connectDB();
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereConditions = ['1=1'];

    if (status) {
      whereConditions.push('sa.status = @status');
    }

    if (user_id) {
      whereConditions.push('sa.user_id = @userId');
    }

    if (reason_category) {
      whereConditions.push('sa.reason_category = @reasonCategory');
    }

    if (search) {
      whereConditions.push('(u.first_name + \' \' + u.last_name LIKE @search OR standby.asset_tag LIKE @search OR original.asset_tag LIKE @search)');
    }

    const whereClause = whereConditions.join(' AND ');

    // Build query
    const request = pool.request()
      .input('limit', sql.Int, parseInt(limit))
      .input('offset', sql.Int, offset);

    if (status) request.input('status', sql.VarChar(50), status);
    if (user_id) request.input('userId', sql.UniqueIdentifier, user_id);
    if (reason_category) request.input('reasonCategory', sql.VarChar(50), reason_category);
    if (search) request.input('search', sql.VarChar(100), `%${search}%`);

    // Get total count
    const countResult = await request.query(`
      SELECT COUNT(*) as total
      FROM STANDBY_ASSIGNMENTS sa
      INNER JOIN USER_MASTER u ON sa.user_id = u.user_id
      INNER JOIN assets standby ON sa.standby_asset_id = standby.id
      LEFT JOIN assets original ON sa.original_asset_id = original.id
      WHERE ${whereClause}
    `);

    const total = countResult.recordset[0].total;

    // Get assignments
    const result = await request.query(`
      SELECT
        sa.id,
        sa.user_id,
        sa.standby_asset_id,
        sa.original_asset_id,
        sa.reason,
        sa.reason_category,
        sa.assigned_date,
        sa.expected_return_date,
        sa.actual_return_date,
        sa.status,
        sa.notes,
        sa.return_notes,
        sa.created_by,
        sa.created_at,
        sa.returned_by,
        sa.returned_at,
        sa.made_permanent_by,
        sa.made_permanent_at,
        u.first_name + ' ' + u.last_name as user_name,
        u.email as user_email,
        u.employee_id,
        u.department_id,
        dept.department_name,
        u.location_id,
        loc.name as location_name,
        standby.asset_tag as standby_asset_tag,
        standby.serial_number as standby_serial_number,
        standby_product.name as standby_product_name,
        standby_product.model as standby_product_model,
        original.asset_tag as original_asset_tag,
        original.serial_number as original_serial_number,
        original.status as original_status,
        original_product.name as original_product_name,
        original_product.model as original_product_model,
        creator.first_name + ' ' + creator.last_name as assigned_by_name,
        returner.first_name + ' ' + returner.last_name as returned_by_name,
        permanent_maker.first_name + ' ' + permanent_maker.last_name as made_permanent_by_name,
        DATEDIFF(DAY, sa.assigned_date, COALESCE(sa.actual_return_date, GETUTCDATE())) as days_assigned
      FROM STANDBY_ASSIGNMENTS sa
      INNER JOIN USER_MASTER u ON sa.user_id = u.user_id
      INNER JOIN assets standby ON sa.standby_asset_id = standby.id
      INNER JOIN products standby_product ON standby.product_id = standby_product.id
      LEFT JOIN assets original ON sa.original_asset_id = original.id
      LEFT JOIN products original_product ON original.product_id = original_product.id
      LEFT JOIN USER_MASTER creator ON sa.created_by = creator.user_id
      LEFT JOIN USER_MASTER returner ON sa.returned_by = returner.user_id
      LEFT JOIN USER_MASTER permanent_maker ON sa.made_permanent_by = permanent_maker.user_id
      LEFT JOIN DEPARTMENT_MASTER dept ON u.department_id = dept.department_id
      LEFT JOIN locations loc ON u.location_id = loc.id
      WHERE ${whereClause}
      ORDER BY sa.assigned_date DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    return sendSuccess(res, {
      assignments: result.recordset,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    }, 'Standby assignments retrieved successfully');

  } catch (error) {
    console.error('Error fetching standby assignments:', error);
    return sendError(res, 'Failed to fetch standby assignments', 500);
  }
};

/**
 * Assign standby asset to user
 * POST /api/v1/standby-assignments
 */
const assignStandbyAsset = async (req, res) => {
  try {
    const {
      user_id,
      standby_asset_id,
      original_asset_id,
      reason,
      reason_category,
      expected_return_date,
      notes
    } = req.body;

    const performedBy = req.user?.id;

    const pool = await connectDB();

    // Get performer name safely using helper function
    const performedByName = await getUserFullName(req.user, pool);

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Validate user exists
      const userCheck = await transaction.request()
        .input('userId', sql.UniqueIdentifier, user_id)
        .query('SELECT user_id, first_name, last_name FROM USER_MASTER WHERE user_id = @userId AND is_active = 1');

      if (userCheck.recordset.length === 0) {
        await transaction.rollback();
        return sendNotFound(res, 'User not found');
      }

      const user = userCheck.recordset[0];

      // Validate standby asset exists and is available
      const standbyCheck = await transaction.request()
        .input('assetId', sql.UniqueIdentifier, standby_asset_id)
        .query(`
          SELECT id, asset_tag, is_standby_asset, standby_available, assigned_to
          FROM assets
          WHERE id = @assetId AND is_active = 1
        `);

      if (standbyCheck.recordset.length === 0) {
        await transaction.rollback();
        return sendNotFound(res, 'Standby asset not found');
      }

      const standbyAsset = standbyCheck.recordset[0];

      if (!standbyAsset.is_standby_asset) {
        await transaction.rollback();
        return sendError(res, 'Asset is not in standby pool', 400);
      }

      if (!standbyAsset.standby_available || standbyAsset.assigned_to) {
        await transaction.rollback();
        return sendError(res, 'Standby asset is not available for assignment', 400);
      }

      // Validate original asset if provided
      let originalAsset = null;
      if (original_asset_id) {
        const originalCheck = await transaction.request()
          .input('originalId', sql.UniqueIdentifier, original_asset_id)
          .query(`
            SELECT id, asset_tag, assigned_to, status
            FROM assets
            WHERE id = @originalId AND is_active = 1
          `);

        if (originalCheck.recordset.length === 0) {
          await transaction.rollback();
          return sendNotFound(res, 'Original asset not found');
        }

        originalAsset = originalCheck.recordset[0];

        // Original asset should be assigned to this user or unassigned
        if (originalAsset.assigned_to && originalAsset.assigned_to !== user_id) {
          await transaction.rollback();
          return sendError(res, 'Original asset is not assigned to this user', 400);
        }
      }

      // Step 1: If original asset exists, unassign it and set to maintenance/repair
      if (originalAsset) {
        await transaction.request()
          .input('originalId', sql.UniqueIdentifier, original_asset_id)
          .query(`
            UPDATE assets
            SET assigned_to = NULL,
                status = 'maintenance',
                updated_at = GETUTCDATE()
            WHERE id = @originalId
          `);

        // Log original asset movement
        await transaction.request()
          .input('assetId', sql.UniqueIdentifier, original_asset_id)
          .input('assetTag', sql.VarChar(50), originalAsset.asset_tag)
          .input('movementType', sql.VarChar(20), 'unassigned')
          .input('status', sql.VarChar(20), 'maintenance')
          .input('reason', sql.Text, `Asset sent for ${reason_category}. Standby asset ${standbyAsset.asset_tag} assigned to user.`)
          .input('performedBy', sql.UniqueIdentifier, performedBy)
          .input('performedByName', sql.NVarChar(200), performedByName)
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
      }

      // Step 2: Assign standby asset to user
      await transaction.request()
        .input('assetId', sql.UniqueIdentifier, standby_asset_id)
        .input('userId', sql.UniqueIdentifier, user_id)
        .query(`
          UPDATE assets
          SET assigned_to = @userId,
              standby_available = 0,
              status = 'assigned',
              updated_at = GETUTCDATE()
          WHERE id = @assetId
        `);

      // Log standby asset movement
      await transaction.request()
        .input('assetId', sql.UniqueIdentifier, standby_asset_id)
        .input('assetTag', sql.VarChar(50), standbyAsset.asset_tag)
        .input('movementType', sql.VarChar(20), 'assigned')
        .input('status', sql.VarChar(20), 'assigned')
        .input('assignedTo', sql.UniqueIdentifier, user_id)
        .input('assignedToName', sql.NVarChar(200), `${user.first_name} ${user.last_name}`)
        .input('reason', sql.Text, `Temporary standby assignment. Reason: ${reason}`)
        .input('performedBy', sql.UniqueIdentifier, performedBy)
        .input('performedByName', sql.NVarChar(200), performedByName)
        .query(`
          INSERT INTO ASSET_MOVEMENTS (
            asset_id, asset_tag, movement_type, status,
            assigned_to, assigned_to_name,
            reason, performed_by, performed_by_name, movement_date, created_at
          )
          VALUES (
            @assetId, @assetTag, @movementType, @status,
            @assignedTo, @assignedToName,
            @reason, @performedBy, @performedByName, GETUTCDATE(), GETUTCDATE()
          )
        `);

      // Step 3: Create standby assignment record
      const assignmentId = await transaction.request()
        .input('userId', sql.UniqueIdentifier, user_id)
        .input('standbyAssetId', sql.UniqueIdentifier, standby_asset_id)
        .input('originalAssetId', sql.UniqueIdentifier, original_asset_id)
        .input('reason', sql.VarChar(500), reason)
        .input('reasonCategory', sql.VarChar(50), reason_category)
        .input('expectedReturnDate', sql.Date, expected_return_date)
        .input('notes', sql.Text, notes)
        .input('createdBy', sql.UniqueIdentifier, performedBy)
        .query(`
          INSERT INTO STANDBY_ASSIGNMENTS (
            user_id, standby_asset_id, original_asset_id,
            reason, reason_category, assigned_date, expected_return_date,
            status, notes, created_by, created_at
          )
          OUTPUT INSERTED.id
          VALUES (
            @userId, @standbyAssetId, @originalAssetId,
            @reason, @reasonCategory, GETUTCDATE(), @expectedReturnDate,
            'active', @notes, @createdBy, GETUTCDATE()
          )
        `);

      await transaction.commit();

      return sendCreated(res, {
        assignment_id: assignmentId.recordset[0].id,
        user_id,
        standby_asset_id,
        standby_asset_tag: standbyAsset.asset_tag,
        original_asset_id,
        original_asset_tag: originalAsset?.asset_tag
      }, 'Standby asset assigned successfully');

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Error assigning standby asset:', error);
    return sendError(res, 'Failed to assign standby asset', 500);
  }
};


/**
 * Reassign Standby Asset
 * PUT /api/v1/standby-assignments/:id/reassign
 *
 * Updates ONLY STANDBY_ASSIGNMENTS table.
 * Does NOT update assets table.
 */
const reassignStandbyAsset = async (req, res) => {
  try {
    const { id: assignmentId } = req.params;

    const {
      user_id,
      notes
    } = req.body;

    const performedBy = req.user?.id;

    const pool = await connectDB();

    // Check assignment exists
    const assignmentResult = await pool.request()
      .input('assignmentId', sql.UniqueIdentifier, assignmentId)
      .query(`
        SELECT *
        FROM STANDBY_ASSIGNMENTS
        WHERE id=@assignmentId
      `);

    if (assignmentResult.recordset.length === 0) {
      return sendNotFound(res, 'Standby assignment not found');
    }

    // Check user exists
    const userResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, user_id)
      .query(`
        SELECT user_id
        FROM USER_MASTER
        WHERE user_id=@userId
          AND is_active=1
      `);

    if (userResult.recordset.length === 0) {
      return sendNotFound(res, 'User not found');
    }

    // Update ONLY standby assignment
    // await pool.request()
    //   .input('assignmentId', sql.UniqueIdentifier, assignmentId)
    //   .input('userId', sql.UniqueIdentifier, user_id)
    //   .input('notes', sql.NVarChar(sql.MAX), notes || '')
    //   .input('updatedBy', sql.UniqueIdentifier, performedBy)
    //   .query(`
    //     UPDATE STANDBY_ASSIGNMENTS
    //     SET
    //         user_id=@userId,
    //         notes=@notes,
    //         updated_by=@updatedBy,
    //         updated_at=GETUTCDATE()
    //     WHERE id=@assignmentId
    //   `);


  await pool.request()
  .input('assignmentId', sql.UniqueIdentifier, assignmentId)
  .input('userId', sql.UniqueIdentifier, user_id)
  .input('notes', sql.NVarChar(sql.MAX), notes || '')
  .query(`
      UPDATE STANDBY_ASSIGNMENTS
      SET
          user_id = @userId,
          notes = @notes,
          status = 'active'
      WHERE id = @assignmentId
  `);
  

 await pool.request()
  .input('assetId', sql.UniqueIdentifier, assignmentResult.recordset[0].standby_asset_id)
  .input('userId', sql.UniqueIdentifier, user_id)
  .query(`
      UPDATE assets
      SET
          assigned_to=@userId,
          standby_available=0,
          status='assigned',
          updated_at=GETUTCDATE()
      WHERE id=@assetId
  `);

    const updated = await pool.request()
      .input('assignmentId', sql.UniqueIdentifier, assignmentId)
      .query(`
        SELECT *
        FROM STANDBY_ASSIGNMENTS
        WHERE id=@assignmentId
      `);

    return sendSuccess(
      res,
      {
        assignment: updated.recordset[0]
      },
      'Standby asset reassigned successfully'
    );

  } catch (error) {
    console.error(error);
    return sendError(res, 'Failed to reassign standby asset', 500);
  }
};

/**
 * Unassign Standby Asset
 * PUT /api/v1/standby-assignments/:id/unassign
 */
/**
 * Unassign Standby Asset
 * PUT /api/v1/standby-assignments/:id/unassign
 */
const unassignStandbyAsset = async (req, res) => {
  try {
    const { id: assignmentId } = req.params;
    const performedBy = req.user?.id;

    const pool = await connectDB();

    const transaction = pool.transaction();
    await transaction.begin();

    try {

      // Check active assignment
      const assignmentResult = await transaction.request()
        .input('assignmentId', sql.UniqueIdentifier, assignmentId)
        .query(`
          SELECT *
          FROM STANDBY_ASSIGNMENTS
          WHERE id=@assignmentId
        `);

      if (assignmentResult.recordset.length === 0) {
        await transaction.rollback();
        return sendNotFound(res, 'Standby assignment not found');
      }

      const assignment = assignmentResult.recordset[0];

      // Step 1 - Update standby assignment
     await transaction.request()
  .input('assignmentId', sql.UniqueIdentifier, assignmentId)
  .input('returnedBy', sql.UniqueIdentifier, performedBy)
  .query(`
      UPDATE STANDBY_ASSIGNMENTS
      SET
          status='returned',
          actual_return_date=GETUTCDATE(),
          returned_by=@returnedBy,
          returned_at=GETUTCDATE()
      WHERE id=@assignmentId
  `);

      // Step 2 - Make standby asset available again
      await transaction.request()
  .input('assetId', sql.UniqueIdentifier, assignment.standby_asset_id)
  .query(`
      UPDATE assets
      SET
          assigned_to=NULL,
          standby_available=1,
          status='available',
          updated_at=GETUTCDATE()
      WHERE id=@assetId
  `);

      await transaction.commit();

      return sendSuccess(
        res,
        {
          assignment_id: assignmentId,
          standby_asset_id: assignment.standby_asset_id
        },
        'Standby asset unassigned successfully'
      );

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Error unassigning standby asset:', error);
    return sendError(res, 'Failed to unassign standby asset', 500);
  }
};

/**
 * Return standby asset and swap back to original
 * PUT /api/v1/standby-assignments/:id/return
 */
const returnStandbyAsset = async (req, res) => {
  try {
    const { id: assignmentId } = req.params;
    const { return_notes } = req.body;
    const performedBy = req.user?.id;

    const pool = await connectDB();

    // Get performer name safely using helper function
    const performedByName = await getUserFullName(req.user, pool);

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Get assignment details
      const assignmentCheck = await transaction.request()
        .input('assignmentId', sql.UniqueIdentifier, assignmentId)
        .query(`
          SELECT
            sa.*,
            standby.asset_tag as standby_asset_tag,
            original.asset_tag as original_asset_tag,
            u.first_name + ' ' + u.last_name as user_name
          FROM STANDBY_ASSIGNMENTS sa
          INNER JOIN assets standby ON sa.standby_asset_id = standby.id
          LEFT JOIN assets original ON sa.original_asset_id = original.id
          INNER JOIN USER_MASTER u ON sa.user_id = u.user_id
          WHERE sa.id = @assignmentId
        `);

      if (assignmentCheck.recordset.length === 0) {
        await transaction.rollback();
        return sendNotFound(res, 'Standby assignment not found');
      }

      const assignment = assignmentCheck.recordset[0];

      if (assignment.status !== 'active') {
        await transaction.rollback();
        return sendError(res, 'Assignment is not active', 400);
      }

      // Step 1: Return original asset to user (if exists)
      if (assignment.original_asset_id) {
        await transaction.request()
          .input('originalId', sql.UniqueIdentifier, assignment.original_asset_id)
          .input('userId', sql.UniqueIdentifier, assignment.user_id)
          .query(`
            UPDATE assets
            SET assigned_to = @userId,
                status = 'assigned',
                updated_at = GETUTCDATE()
            WHERE id = @originalId
          `);

        // Log original asset movement
        await transaction.request()
          .input('assetId', sql.UniqueIdentifier, assignment.original_asset_id)
          .input('assetTag', sql.VarChar(50), assignment.original_asset_tag)
          .input('movementType', sql.VarChar(20), 'assigned')
          .input('status', sql.VarChar(20), 'assigned')
          .input('assignedTo', sql.UniqueIdentifier, assignment.user_id)
          .input('assignedToName', sql.NVarChar(200), assignment.user_name)
          .input('reason', sql.Text, `Original asset returned from ${assignment.reason_category}. Standby asset ${assignment.standby_asset_tag} returned to pool.`)
          .input('performedBy', sql.UniqueIdentifier, performedBy)
          .input('performedByName', sql.NVarChar(200), performedByName)
          .query(`
            INSERT INTO ASSET_MOVEMENTS (
              asset_id, asset_tag, movement_type, status,
              assigned_to, assigned_to_name,
              reason, performed_by, performed_by_name, movement_date, created_at
            )
            VALUES (
              @assetId, @assetTag, @movementType, @status,
              @assignedTo, @assignedToName,
              @reason, @performedBy, @performedByName, GETUTCDATE(), GETUTCDATE()
            )
          `);
      }

      // Step 2: Return standby asset to pool
      await transaction.request()
        .input('standbyId', sql.UniqueIdentifier, assignment.standby_asset_id)
        .query(`
          UPDATE assets
          SET assigned_to = NULL,
              standby_available = 1,
              status = 'available',
              updated_at = GETUTCDATE()
          WHERE id = @standbyId
        `);

      // Log standby asset movement
      await transaction.request()
        .input('assetId', sql.UniqueIdentifier, assignment.standby_asset_id)
        .input('assetTag', sql.VarChar(50), assignment.standby_asset_tag)
        .input('movementType', sql.VarChar(20), 'returned')
        .input('status', sql.VarChar(20), 'available')
        .input('reason', sql.Text, `Standby asset returned to pool. Original asset ${assignment.original_asset_tag} returned to user.`)
        .input('performedBy', sql.UniqueIdentifier, performedBy)
        .input('performedByName', sql.NVarChar(200), performedByName)
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

      // Step 3: Update assignment record
      await transaction.request()
        .input('assignmentId', sql.UniqueIdentifier, assignmentId)
        .input('returnNotes', sql.Text, return_notes)
        .input('returnedBy', sql.UniqueIdentifier, performedBy)
        .query(`
          UPDATE STANDBY_ASSIGNMENTS
          SET status = 'returned',
              actual_return_date = GETUTCDATE(),
              return_notes = @returnNotes,
              returned_by = @returnedBy,
              returned_at = GETUTCDATE()
          WHERE id = @assignmentId
        `);

      await transaction.commit();

      return sendSuccess(res, {
        assignment_id: assignmentId,
        standby_asset_tag: assignment.standby_asset_tag,
        original_asset_tag: assignment.original_asset_tag
      }, 'Standby asset returned successfully');

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Error returning standby asset:', error);
    return sendError(res, 'Failed to return standby asset', 500);
  }
};

/**
 * Make standby assignment permanent
 * PUT /api/v1/standby-assignments/:id/permanent
 */
const makeAssignmentPermanent = async (req, res) => {
  try {
    const { id: assignmentId } = req.params;
    const { notes } = req.body;
    const performedBy = req.user?.id;

    const pool = await connectDB();

    // Get performer name safely using helper function
    const performedByName = await getUserFullName(req.user, pool);

    const transaction = pool.transaction();
    await transaction.begin();

    try {
      // Get assignment details
      const assignmentCheck = await transaction.request()
        .input('assignmentId', sql.UniqueIdentifier, assignmentId)
        .query(`
          SELECT
            sa.*,
            standby.asset_tag as standby_asset_tag
          FROM STANDBY_ASSIGNMENTS sa
          INNER JOIN assets standby ON sa.standby_asset_id = standby.id
          WHERE sa.id = @assignmentId
        `);

      if (assignmentCheck.recordset.length === 0) {
        await transaction.rollback();
        return sendNotFound(res, 'Standby assignment not found');
      }

      const assignment = assignmentCheck.recordset[0];

      if (assignment.status !== 'active') {
        await transaction.rollback();
        return sendError(res, 'Assignment is not active', 400);
      }

      // Step 1: Remove standby flag from asset (it's now permanently assigned)
      await transaction.request()
        .input('standbyId', sql.UniqueIdentifier, assignment.standby_asset_id)
        .query(`
          UPDATE assets
          SET is_standby_asset = 0,
              standby_available = 0,
              updated_at = GETUTCDATE()
          WHERE id = @standbyId
        `);

      // Step 2: Update assignment record
      await transaction.request()
        .input('assignmentId', sql.UniqueIdentifier, assignmentId)
        .input('notes', sql.Text, notes)
        .input('madePermanentBy', sql.UniqueIdentifier, performedBy)
        .query(`
          UPDATE STANDBY_ASSIGNMENTS
          SET status = 'permanent',
              return_notes = @notes,
              made_permanent_by = @madePermanentBy,
              made_permanent_at = GETUTCDATE()
          WHERE id = @assignmentId
        `);

      // Log movement
      await transaction.request()
        .input('assetId', sql.UniqueIdentifier, assignment.standby_asset_id)
        .input('assetTag', sql.VarChar(50), assignment.standby_asset_tag)
        .input('movementType', sql.VarChar(20), 'assigned')
        .input('status', sql.VarChar(20), 'assigned')
        .input('reason', sql.Text, `Standby assignment made permanent. ${notes || ''}`)
        .input('performedBy', sql.UniqueIdentifier, performedBy)
        .input('performedByName', sql.NVarChar(200), performedByName)
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

      await transaction.commit();

      return sendSuccess(res, {
        assignment_id: assignmentId,
        standby_asset_tag: assignment.standby_asset_tag
      }, 'Standby assignment made permanent successfully');

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Error making assignment permanent:', error);
    return sendError(res, 'Failed to make assignment permanent', 500);
  }
};

/**
 * Get user's standby assignment history
 * GET /api/v1/standby-assignments/user/:userId
 */
const getUserStandbyHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    const pool = await connectDB();

    const result = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`
        SELECT
          sa.*,
          standby.asset_tag as standby_asset_tag,
          standby_product.name as standby_product_name,
          original.asset_tag as original_asset_tag,
          original_product.name as original_product_name,
          creator.first_name + ' ' + creator.last_name as created_by_name,
          returner.first_name + ' ' + returner.last_name as returned_by_name,
          DATEDIFF(DAY, sa.assigned_date, COALESCE(sa.actual_return_date, GETUTCDATE())) as days_assigned
        FROM STANDBY_ASSIGNMENTS sa
        INNER JOIN assets standby ON sa.standby_asset_id = standby.id
        INNER JOIN products standby_product ON standby.product_id = standby_product.id
        LEFT JOIN assets original ON sa.original_asset_id = original.id
        LEFT JOIN products original_product ON original.product_id = original_product.id
        LEFT JOIN USER_MASTER creator ON sa.created_by = creator.user_id
        LEFT JOIN USER_MASTER returner ON sa.returned_by = returner.user_id
        WHERE sa.user_id = @userId
        ORDER BY sa.assigned_date DESC
      `);

    return sendSuccess(res, result.recordset, 'User standby history retrieved successfully');

  } catch (error) {
    console.error('Error fetching user standby history:', error);
    return sendError(res, 'Failed to fetch user standby history', 500);
  }
};

/**
 * Get asset's standby assignment history
 * GET /api/v1/standby-assignments/asset/:assetId/history
 */
const getAssetStandbyHistory = async (req, res) => {
  try {
    const { assetId } = req.params;

    const pool = await connectDB();

    const result = await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT
          sa.*,
          u.first_name + ' ' + u.last_name as user_name,
          u.email as user_email,
          creator.first_name + ' ' + creator.last_name as created_by_name,
          returner.first_name + ' ' + returner.last_name as returned_by_name,
          DATEDIFF(DAY, sa.assigned_date, COALESCE(sa.actual_return_date, GETUTCDATE())) as days_assigned
        FROM STANDBY_ASSIGNMENTS sa
        INNER JOIN USER_MASTER u ON sa.user_id = u.user_id
        LEFT JOIN USER_MASTER creator ON sa.created_by = creator.user_id
        LEFT JOIN USER_MASTER returner ON sa.returned_by = returner.user_id
        WHERE sa.standby_asset_id = @assetId
        ORDER BY sa.assigned_date DESC
      `);

    return sendSuccess(res, result.recordset, 'Asset standby history retrieved successfully');

  } catch (error) {
    console.error('Error fetching asset standby history:', error);
    return sendError(res, 'Failed to fetch asset standby history', 500);
  }
};

module.exports = {
  getStandbyAssignments,
  assignStandbyAsset,
  reassignStandbyAsset,
  unassignStandbyAsset,
  returnStandbyAsset,
  makeAssignmentPermanent,
  getUserStandbyHistory,
  getAssetStandbyHistory
};
