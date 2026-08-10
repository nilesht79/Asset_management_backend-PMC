const { connectDB } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');

/**
 * Asset Movement Model
 * Handles all database operations for asset movement tracking
 */

class AssetMovementModel {
  /**
   * Get movement history for a specific asset
   * @param {string} assetId - Asset UUID
   * @param {object} options - Query options (limit, offset, orderBy)
   * @returns {Promise<Array>} Movement history records
   */
  static async getAssetMovementHistory(assetId, options = {}) {
    try {
      const pool = await connectDB();
      const { limit = 100, offset = 0, orderBy = 'movement_date DESC' } = options;

      const result = await pool.request()
        .input('asset_id', assetId)
        .input('limit', limit)
        .input('offset', offset)
        .query(`
          SELECT
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            previous_user_id,
            previous_user_name,
            previous_location_id,
            previous_location_name,
            movement_date,
            reason,
            notes,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE asset_id = @asset_id
          ORDER BY ${orderBy}
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching asset movement history:', error);
      throw error;
    }
  }

  /**
   * Get all movements for a user (assets assigned to them)
   * @param {string} userId - User UUID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Movement records
   */
  static async getUserMovementHistory(userId, options = {}) {
    try {
      const pool = await connectDB();
      const { limit = 100, offset = 0 } = options;

      const result = await pool.request()
        .input('user_id', userId)
        .input('limit', limit)
        .input('offset', offset)
        .query(`
          SELECT
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            previous_user_id,
            previous_user_name,
            previous_location_id,
            previous_location_name,
            movement_date,
            reason,
            notes,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE assigned_to = @user_id
          ORDER BY movement_date DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching user movement history:', error);
      throw error;
    }
  }

  /**
   * Get all movements for a location
   * @param {string} locationId - Location UUID
   * @param {object} options - Query options
   * @returns {Promise<Array>} Movement records
   */
  static async getLocationMovementHistory(locationId, options = {}) {
    try {
      const pool = await connectDB();
      const { limit = 100, offset = 0 } = options;

      const result = await pool.request()
        .input('location_id', locationId)
        .input('limit', limit)
        .input('offset', offset)
        .query(`
          SELECT
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            previous_user_id,
            previous_user_name,
            previous_location_id,
            previous_location_name,
            movement_date,
            reason,
            notes,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE location_id = @location_id
          ORDER BY movement_date DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching location movement history:', error);
      throw error;
    }
  }

  /**
   * Get recent movements (all assets)
   * @param {object} options - Query options
   * @returns {Promise<Array>} Recent movement records
   */
  static async getRecentMovements(options = {}) {
    try {
      const pool = await connectDB();
      const {
        limit = 50,
        offset = 0,
        assetTag,
        movementType,
        status,
        startDate,
        endDate
      } = options;

      // Build dynamic WHERE clause
      const whereConditions = [];

      // Create separate requests for count and data
      const countRequest = pool.request();
      const dataRequest = pool.request();

      // Add filters if provided (to both requests)
      if (assetTag) {
        whereConditions.push('a.serial_number LIKE @assetTag');
        countRequest.input('assetTag', `%${assetTag}%`);
        dataRequest.input('assetTag', `%${assetTag}%`);
      }

      if (movementType) {
        whereConditions.push('am.movement_type = @movementType');
        countRequest.input('movementType', movementType);
        dataRequest.input('movementType', movementType);
      }

      if (status) {
        whereConditions.push('am.status = @status');
        countRequest.input('status', status);
        dataRequest.input('status', status);
      }

      if (startDate) {
        whereConditions.push('am.movement_date >= @startDate');
        countRequest.input('startDate', startDate);
        dataRequest.input('startDate', startDate);
      }

      if (endDate) {
        // Add one day to endDate to include the entire end date
        whereConditions.push('am.movement_date < DATEADD(day, 1, @endDate)');
        countRequest.input('endDate', endDate);
        dataRequest.input('endDate', endDate);
      }

      // Build WHERE clause
      const whereClause = whereConditions.length > 0
        ? 'WHERE ' + whereConditions.join(' AND ')
        : '';

      // Get total count
      const countResult = await countRequest.query(`
        SELECT COUNT(*) as total
        FROM ASSET_MOVEMENTS am
        LEFT JOIN ASSETS a ON am.asset_id = a.id
        ${whereClause}
      `);

      const totalCount = countResult.recordset[0].total;

      // Get paginated data
      dataRequest.input('limit', limit);
      dataRequest.input('offset', offset);

      // const dataResult = await dataRequest.query(`
      //   SELECT
      //     am.id,
      //     am.asset_id,
      //     am.asset_tag,
      //     a.serial_number,
      //     am.assigned_to,
      //     am.assigned_to_name,
      //     am.location_id,
      //     am.location_name,
      //     am.movement_type,
      //     am.status,
      //     am.previous_user_id,
      //     am.previous_user_name,
      //     am.previous_location_id,
      //     am.previous_location_name,
      //     am.movement_date,
      //     am.reason,
      //     am.notes,
      //     am.performed_by,
      //     am.performed_by_name,
      //     am.created_at
      //   FROM ASSET_MOVEMENTS am
      //   LEFT JOIN ASSETS a ON am.asset_id = a.id
      //   ${whereClause}
      //   ORDER BY am.movement_date DESC
      //   OFFSET @offset ROWS
      //   FETCH NEXT @limit ROWS ONLY
      // `);

      const dataResult = await dataRequest.query(`
      SELECT
          am.id,
          am.asset_id,
          am.asset_tag,
          a.serial_number,
        
          c.name AS subcategory_name,
        
          am.assigned_to,
          am.assigned_to_name,
          am.location_id,
          am.location_name,
          am.movement_type,
          am.status,
          am.previous_user_id,
          am.previous_user_name,
          am.previous_location_id,
          am.previous_location_name,
          am.movement_date,
          am.reason,
          am.notes,
          am.performed_by,
          am.performed_by_name,
          am.created_at
        
        FROM ASSET_MOVEMENTS am
        
        LEFT JOIN ASSETS a
            ON am.asset_id = a.id
        
        LEFT JOIN PRODUCTS p
            ON a.product_id = p.id
        
        LEFT JOIN CATEGORIES c
            ON p.subcategory_id = c.id
        
        ${whereClause}
        
        ORDER BY am.movement_date DESC
        
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      return {
        data: dataResult.recordset,
        total: totalCount
      };
    } catch (error) {
      console.error('Error fetching recent movements:', error);
      throw error;
    }
  }

  /**
   * Create a new movement record
   * @param {object} movementData - Movement details
   * @param {string} performedBy - User ID who performed the action
   * @returns {Promise<object>} Created movement record
   */
  static async createMovement(movementData, performedBy) {
    try {
      const pool = await connectDB();
      const {
        assetId,
        assignedTo = null,
        locationId = null,
        movementType,
        status,
        previousUserId = null,
        previousLocationId = null,
        movementDate = new Date(),
        reason = null,
        notes = null
      } = movementData;

      // Get asset details
      const assetResult = await pool.request()
        .input('asset_id', assetId)
        .query('SELECT asset_tag FROM ASSETS WHERE id = @asset_id');

      if (assetResult.recordset.length === 0) {
        throw new Error('Asset not found');
      }

      const assetTag = assetResult.recordset[0].asset_tag;

      // Get assigned user name and location if exists
      let assignedToName = null;
      let userLocationId = null;
      if (assignedTo) {
        const userResult = await pool.request()
          .input('user_id', assignedTo)
          .query('SELECT first_name, last_name, location_id FROM USER_MASTER WHERE user_id = @user_id');

        if (userResult.recordset.length > 0) {
          const user = userResult.recordset[0];
          assignedToName = `${user.first_name} ${user.last_name}`;
          userLocationId = user.location_id; // Store user's location for fallback
        }
      }

      // Use provided locationId or fallback to user's location for install/assign movements
      let effectiveLocationId = locationId;
      if (!effectiveLocationId && userLocationId) {
        effectiveLocationId = userLocationId;
      }

      // Get location name if exists
      let locationName = null;
      if (effectiveLocationId) {
        const locationResult = await pool.request()
          .input('location_id', effectiveLocationId)
          .query('SELECT name FROM LOCATIONS WHERE id = @location_id');

        if (locationResult.recordset.length > 0) {
          locationName = locationResult.recordset[0].name;
        }
      }

      // Get previous user name if exists
      let previousUserName = null;
      if (previousUserId) {
        const prevUserResult = await pool.request()
          .input('user_id', previousUserId)
          .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @user_id');

        if (prevUserResult.recordset.length > 0) {
          const user = prevUserResult.recordset[0];
          previousUserName = `${user.first_name} ${user.last_name}`;
        }
      }

      // Get previous location name if exists
      let previousLocationName = null;
      if (previousLocationId) {
        const prevLocResult = await pool.request()
          .input('location_id', previousLocationId)
          .query('SELECT name FROM LOCATIONS WHERE id = @location_id');

        if (prevLocResult.recordset.length > 0) {
          previousLocationName = prevLocResult.recordset[0].name;
        }
      }

      // Get performer name and ID
      let performedByUserId = performedBy;
      let performedByName = 'System';

      if (performedBy) {
        const performerResult = await pool.request()
          .input('user_id', performedBy)
          .query('SELECT user_id, first_name, last_name FROM USER_MASTER WHERE user_id = @user_id');

        if (performerResult.recordset.length > 0) {
          const performer = performerResult.recordset[0];
          performedByUserId = performer.user_id;
          performedByName = `${performer.first_name} ${performer.last_name}`;
        } else {
          console.warn(`Performer user not found for ID: ${performedBy}. Using system user.`);
          performedByUserId = null;
        }
      } else {
        console.warn('No performedBy ID provided. Using system user.');
        performedByUserId = null;
      }

      // If no valid performer, get a system admin user
      if (!performedByUserId) {
        const systemUserResult = await pool.request()
          .query(`
            SELECT TOP 1 user_id, first_name, last_name
            FROM USER_MASTER
            WHERE role IN ('superadmin', 'admin') AND is_active = 1
            ORDER BY created_at ASC
          `);

        if (systemUserResult.recordset.length > 0) {
          const systemUser = systemUserResult.recordset[0];
          performedByUserId = systemUser.user_id;
          performedByName = `${systemUser.first_name} ${systemUser.last_name} (System)`;
        } else {
          throw new Error('No system user available for movement logging');
        }
      }

      // Validate data quality before insert
      if (!performedByName || performedByName.trim().length === 0) {
        throw new Error('Invalid performer name - cannot be empty (database constraint would reject this)');
      }

      if (performedByName.includes('undefined')) {
        throw new Error('Invalid performer name - contains "undefined" (database constraint would reject this)');
      }

      if (assignedTo && (!assignedToName || assignedToName.trim().length === 0)) {
        throw new Error('assigned_to is set but assigned_to_name is missing (database constraint would reject this)');
      }

      if (assignedToName && assignedToName.includes('undefined')) {
        throw new Error('Invalid assigned_to_name - contains "undefined" (database constraint would reject this)');
      }

      // Insert movement record
      const movementId = uuidv4();
      const result = await pool.request()
        .input('id', movementId)
        .input('asset_id', assetId)
        .input('asset_tag', assetTag)
        .input('assigned_to', assignedTo)
        .input('assigned_to_name', assignedToName)
        .input('location_id', effectiveLocationId)
        .input('location_name', locationName)
        .input('movement_type', movementType)
        .input('status', status)
        .input('previous_user_id', previousUserId)
        .input('previous_user_name', previousUserName)
        .input('previous_location_id', previousLocationId)
        .input('previous_location_name', previousLocationName)
        .input('movement_date', movementDate)
        .input('reason', reason)
        .input('notes', notes)
        .input('performed_by', performedByUserId)
        .input('performed_by_name', performedByName)
        .query(`
          INSERT INTO ASSET_MOVEMENTS (
            id, asset_id, asset_tag,
            assigned_to, assigned_to_name,
            location_id, location_name,
            movement_type, status,
            previous_user_id, previous_user_name,
            previous_location_id, previous_location_name,
            movement_date, reason, notes,
            performed_by, performed_by_name,
            created_at
          )
          OUTPUT INSERTED.*
          VALUES (
            @id, @asset_id, @asset_tag,
            @assigned_to, @assigned_to_name,
            @location_id, @location_name,
            @movement_type, @status,
            @previous_user_id, @previous_user_name,
            @previous_location_id, @previous_location_name,
            @movement_date, @reason, @notes,
            @performed_by, @performed_by_name,
            GETUTCDATE()
          )
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating movement record:', error);
      throw error;
    }
  }

  /**
   * Get movement statistics for dashboard
   * @param {object} filters - Date range filters
   * @returns {Promise<object>} Statistics
   */
  static async getMovementStatistics(filters = {}) {
    try {
      const pool = await connectDB();
      const { startDate, endDate } = filters;

      let dateFilter = '';
      if (startDate && endDate) {
        dateFilter = `WHERE movement_date BETWEEN '${startDate}' AND '${endDate}'`;
      }

      const result = await pool.request().query(`
        SELECT
          COUNT(*) as total_movements,
          COUNT(DISTINCT asset_id) as unique_assets,
          COUNT(DISTINCT assigned_to) as unique_users,
          SUM(CASE WHEN movement_type = 'assigned' THEN 1 ELSE 0 END) as assignments,
          SUM(CASE WHEN movement_type = 'transferred' THEN 1 ELSE 0 END) as transfers,
          SUM(CASE WHEN movement_type = 'returned' THEN 1 ELSE 0 END) as returns,
          SUM(CASE WHEN movement_type = 'relocated' THEN 1 ELSE 0 END) as relocations
        FROM ASSET_MOVEMENTS
        ${dateFilter}
      `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching movement statistics:', error);
      throw error;
    }
  }

  /**
   * Get current assignment for an asset (most recent movement)
   * @param {string} assetId - Asset UUID
   * @returns {Promise<object>} Current movement record
   */
  static async getCurrentAssignment(assetId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('asset_id', assetId)
        .query(`
          SELECT TOP 1
            id,
            asset_id,
            asset_tag,
            assigned_to,
            assigned_to_name,
            location_id,
            location_name,
            movement_type,
            status,
            movement_date,
            reason,
            performed_by,
            performed_by_name,
            created_at
          FROM ASSET_MOVEMENTS
          WHERE asset_id = @asset_id
          ORDER BY movement_date DESC
        `);

      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error fetching current assignment:', error);
      throw error;
    }
  }

  /**
   * Export asset movements to Excel
   * @param {object} options - Filter options (same as getRecentMovements)
   * @returns {Promise<Buffer>} Excel file buffer
   */
  static async exportToExcel(options = {}) {
    try {
      const pool = await connectDB();
      const {
        assetTag,
        movementType,
        status,
        startDate,
        endDate
      } = options;

      // Build dynamic WHERE clause (same logic as getRecentMovements)
      const whereConditions = [];
      const request = pool.request();

      if (assetTag) {
        whereConditions.push('asset_tag LIKE @assetTag');
        request.input('assetTag', `%${assetTag}%`);
      }

      if (movementType) {
        whereConditions.push('movement_type = @movementType');
        request.input('movementType', movementType);
      }

      if (status) {
        whereConditions.push('status = @status');
        request.input('status', status);
      }

      if (startDate) {
        whereConditions.push('movement_date >= @startDate');
        request.input('startDate', startDate);
      }

      if (endDate) {
        whereConditions.push('movement_date < DATEADD(day, 1, @endDate)');
        request.input('endDate', endDate);
      }

      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      // Fetch all matching records (no pagination for export)
      // const result = await request.query(`
      //   SELECT
      //     asset_tag,
      //     movement_type,
      //     status,
      //     movement_date,
      //     assigned_to_name,
      //     location_name,
      //     previous_user_name,
      //     previous_location_name,
      //     reason,
      //     notes,
      //     performed_by_name,
      //     parent_asset_tag
      //   FROM ASSET_MOVEMENTS
      //   ${whereClause}
      //   ORDER BY movement_date DESC
      // `);

      const result = await request.query(`
        SELECT
            am.asset_tag,
            a.serial_number,
            c.name AS subcategory_name,
        
            am.movement_type,
            am.status,
            am.movement_date,
            am.assigned_to_name,
            am.location_name,
            am.previous_user_name,
            am.previous_location_name,
            am.reason,
            am.notes,
            am.performed_by_name,
            am.parent_asset_tag
        
        FROM ASSET_MOVEMENTS am
        
        LEFT JOIN ASSETS a
            ON am.asset_id = a.id
        
        LEFT JOIN PRODUCTS p
            ON a.product_id = p.id
        
        LEFT JOIN CATEGORIES c
            ON p.subcategory_id = c.id
        
        ${whereClause}
        
        ORDER BY am.movement_date DESC
      `);

      const movements = result.recordset;

      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Asset Movements');

      // Set worksheet properties
      worksheet.properties.defaultRowHeight = 20;

      // Define columns with headers
      // worksheet.columns = [
      //   { header: 'Date & Time', key: 'movement_date', width: 20 },
      //   { header: 'Asset Tag', key: 'asset_tag', width: 15 },
      //   { header: 'Movement Type', key: 'movement_type', width: 18 },
      //   { header: 'Status', key: 'status', width: 12 },
      //   { header: 'Assigned To', key: 'assigned_to_name', width: 20 },
      //   { header: 'Location', key: 'location_name', width: 25 },
      //   { header: 'Previous User', key: 'previous_user_name', width: 20 },
      //   { header: 'Previous Location', key: 'previous_location_name', width: 25 },
      //   { header: 'Reason', key: 'reason', width: 30 },
      //   { header: 'Notes', key: 'notes', width: 30 },
      //   { header: 'Performed By', key: 'performed_by_name', width: 20 },
      //   { header: 'Parent Asset', key: 'parent_asset_tag', width: 15 }
      // ];

      worksheet.columns = [
        { header: 'Date & Time', key: 'movement_date', width: 20 },
        { header: 'Asset Tag', key: 'asset_tag', width: 18 },
        { header: 'Serial Number', key: 'serial_number', width: 22 },
        { header: 'Sub Category', key: 'subcategory_name', width: 22 },
        { header: 'Movement Type', key: 'movement_type', width: 18 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Assigned To', key: 'assigned_to_name', width: 22 },
        { header: 'Location', key: 'location_name', width: 25 },
        { header: 'Previous User', key: 'previous_user_name', width: 22 },
        { header: 'Previous Location', key: 'previous_location_name', width: 25 },
        { header: 'Reason', key: 'reason', width: 30 },
        { header: 'Notes', key: 'notes', width: 30 },
        { header: 'Performed By', key: 'performed_by_name', width: 20 },
        { header: 'Parent Asset', key: 'parent_asset_tag', width: 18 }
      ];

      // Style the header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1890FF' }
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 25;

      // Add data rows
      movements.forEach((movement) => {
        // const row = worksheet.addRow({
        //   movement_date: movement.movement_date,
        //   asset_tag: movement.asset_tag,
        //   movement_type: movement.movement_type?.replace(/_/g, ' ').toUpperCase(),
        //   status: movement.status?.toUpperCase(),
        //   assigned_to_name: movement.assigned_to_name || '—',
        //   location_name: movement.location_name || '—',
        //   previous_user_name: movement.previous_user_name || '—',
        //   previous_location_name: movement.previous_location_name || '—',
        //   reason: movement.reason || '—',
        //   notes: movement.notes || '—',
        //   performed_by_name: movement.performed_by_name,
        //   parent_asset_tag: movement.parent_asset_tag || '—'
        // });

        const row = worksheet.addRow({
          movement_date: movement.movement_date,
          asset_tag: movement.asset_tag,
          serial_number: movement.serial_number || '—',
          subcategory_name: movement.subcategory_name || '—',
          movement_type: movement.movement_type?.replace(/_/g, ' ').toUpperCase(),
          status: movement.status?.toUpperCase(),
          assigned_to_name: movement.assigned_to_name || '—',
          location_name: movement.location_name || '—',
          previous_user_name: movement.previous_user_name || '—',
          previous_location_name: movement.previous_location_name || '—',
          reason: movement.reason || '—',
          notes: movement.notes || '—',
          performed_by_name: movement.performed_by_name,
          parent_asset_tag: movement.parent_asset_tag || '—'
        });

        // Format date column
        row.getCell('movement_date').numFmt = 'dd-mmm-yyyy hh:mm:ss';

        // Alternate row colors
        if (row.number % 2 === 0) {
          row.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF5F5F5' }
          };
        }

        // Set row alignment
        row.alignment = { vertical: 'middle', wrapText: true };
      });

      // Add filters to header row
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 12 }
      };

      // Freeze header row
      worksheet.views = [
        { state: 'frozen', xSplit: 0, ySplit: 1 }
      ];

      // Add borders to all cells
      worksheet.eachRow((row, rowNumber) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
          };
        });
      });

      // Add summary information at the top (insert rows before data)
      worksheet.spliceRows(1, 0,
        ['Asset Movement Export Report'],
        [`Generated: ${new Date().toLocaleString()}`],
        [`Total Records: ${movements.length}`]
      );

      // Style summary section
      const titleRow = worksheet.getRow(1);
      titleRow.font = { bold: true, size: 14, color: { argb: 'FF1890FF' } };
      titleRow.height = 25;

      const dateRow = worksheet.getRow(2);
      dateRow.font = { italic: true, size: 10 };

      const countRow = worksheet.getRow(3);
      countRow.font = { bold: true, size: 10 };

      // Add empty row after summary
      worksheet.spliceRows(4, 0, []);

      // Update freeze pane to account for summary rows (freeze at row 5 which is the header)
      worksheet.views = [
        { state: 'frozen', xSplit: 0, ySplit: 5 }
      ];

      // Update autoFilter to start from row 5 (header row after summary)
      worksheet.autoFilter = {
        from: { row: 5, column: 1 },
        to: { row: 5, column: 12 }
      };

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return buffer;

    } catch (error) {
      console.error('Error exporting to Excel:', error);
      throw error;
    }
  }
}

module.exports = AssetMovementModel;
