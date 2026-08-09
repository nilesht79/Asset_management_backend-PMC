/**
 * Asset Job Reports Route
 * Provides reports for IT Asset Install, Move, and Transfer activities
 */

const express = require('express');
const router = express.Router();
const { connectDB, sql } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { asyncHandler } = require('../middleware/error-handler');
const { sendSuccess, sendError } = require('../utils/response');
const { roles: USER_ROLES } = require('../config/auth');
const AssetJobReportPDF = require('../utils/assetJobReportPDF');
const ExcelJS = require('exceljs');

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /api/v1/asset-reports/job-reports
 * Get asset job reports (Install, Move, Transfer)
 *
 * Query params:
 * - report_type: 'install' | 'move' | 'transfer' | 'all' (default: 'all')
 * - date_from, date_to: Date range filter
 * - location_id: Filter by location
 * - department_id: Filter by department
 * - user_id: Filter by assigned user
 * - category_id: Filter by asset category
 * - oem_id: Filter by OEM
 * - product_id: Filter by product
 * - search: Search by asset tag, serial number, or user name
 * - page, limit: Pagination
 */
router.get('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const {
      report_type = 'all',
      date_from,
      date_to,
      location_id,
      department_id,
      user_id,
      category_id,
      oem_id,
      product_id,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const pool = await connectDB();
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build WHERE clause based on report type
    let typeCondition = '';
    switch (report_type) {
      case 'install':
        // First-time assignment: movement_type = 'assigned' AND previous user is NULL
        typeCondition = "AND am.movement_type = 'assigned' AND am.previous_user_id IS NULL";
        break;
      case 'move':
        // Movement from inventory: movement_type = 'assigned' AND has previous location but no previous user
        // OR relocated type
        typeCondition = "AND (am.movement_type = 'relocated' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NULL AND am.previous_location_id IS NOT NULL))";
        break;
      case 'transfer':
        // Transfer: movement_type = 'transferred' OR (assigned with previous user)
        typeCondition = "AND (am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL))";
        break;
      default:
        // All: include assigned, transferred, relocated
        typeCondition = "AND am.movement_type IN ('assigned', 'transferred', 'relocated')";
    }

    // Build filter conditions
    let filterConditions = '';
    const request = pool.request();

    if (date_from) {
      filterConditions += ' AND CAST(am.movement_date AS DATE) >= @date_from';
      request.input('date_from', sql.Date, date_from);
    }

    if (date_to) {
      filterConditions += ' AND CAST(am.movement_date AS DATE) <= @date_to';
      request.input('date_to', sql.Date, date_to);
    }

    if (location_id) {
      filterConditions += ' AND am.location_id = @location_id';
      request.input('location_id', sql.UniqueIdentifier, location_id);
    }

    if (department_id) {
      filterConditions += ' AND (assigned_user.department_id = @department_id OR prev_user.department_id = @department_id)';
      request.input('department_id', sql.UniqueIdentifier, department_id);
    }

    if (user_id) {
      filterConditions += ' AND (am.assigned_to = @user_id OR am.previous_user_id = @user_id)';
      request.input('user_id', sql.UniqueIdentifier, user_id);
    }

    if (category_id) {
      filterConditions += ' AND p.category_id = @category_id';
      request.input('category_id', sql.UniqueIdentifier, category_id);
    }

    if (oem_id) {
      filterConditions += ' AND p.oem_id = @oem_id';
      request.input('oem_id', sql.UniqueIdentifier, oem_id);
    }

    if (product_id) {
      filterConditions += ' AND a.product_id = @product_id';
      request.input('product_id', sql.UniqueIdentifier, product_id);
    }

    if (search) {
      filterConditions += ` AND (
        a.asset_tag LIKE @search
        OR a.serial_number LIKE @search
        OR (assigned_user.first_name + ' ' + assigned_user.last_name) LIKE @search
        OR (prev_user.first_name + ' ' + prev_user.last_name) LIKE @search
      )`;
      request.input('search', sql.VarChar(100), `%${search}%`);
    }

    // Main query
    const query = `
      SELECT
        am.id as movement_id,
        am.movement_date,
        am.movement_type,
        am.status,
        am.reason,
        am.notes,

        -- Asset info
        a.id as asset_id,
        a.asset_tag,
        a.serial_number,
        p.name as product_name,
        p.model as product_model,
        oem.name as oem_name,
        cat.name as category_name,

        -- Current assignment
        am.assigned_to,
        COALESCE(assigned_user.first_name + ' ' + assigned_user.last_name, am.assigned_to_name) as assigned_to_name,
        assigned_user.email as assigned_to_email,
        assigned_user.employee_id as assigned_to_emp_code,
        asset_dept.department_name as assigned_to_department,

        -- Current location (fallback: movement location -> user's location)
        am.location_id,
        
        CONCAT(
            asset_loc.name,
            CASE
                WHEN asset_loc.floor IS NOT NULL
                     AND LTRIM(RTRIM(asset_loc.floor)) <> ''
                THEN ' - ' + asset_loc.floor
                ELSE ''
            END
        ) AS location_name,
        
        asset_loc.building AS location_building,
        asset_loc.floor AS location_floor,
        assigned_user.room_no as location_room_no,
        assigned_user.room_no as location_room_no,

        -- Previous user (for transfers)
        am.previous_user_id,
        COALESCE(prev_user.first_name + ' ' + prev_user.last_name, am.previous_user_name) as previous_user_name,
        prev_user.email as previous_user_email,
        prev_user.employee_id as previous_user_emp_code,
        prev_dept.department_name as previous_user_department,

        -- Previous location (use denormalized data from ASSET_MOVEMENTS if join returns NULL)
        am.previous_location_id,
        COALESCE(prev_loc.name, am.previous_location_name) as previous_location_name,
        prev_loc.building as previous_location_building,
        prev_loc.floor as previous_location_floor,
        prev_user.room_no as previous_location_room_no,

        -- Performed by
        am.performed_by,
        performer.first_name + ' ' + performer.last_name as performed_by_name,

        -- Computed report type
        CASE
          WHEN am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL)
            THEN 'transfer'
          WHEN am.movement_type = 'relocated'
            THEN 'move'
          WHEN am.movement_type = 'assigned' AND am.previous_user_id IS NULL
            THEN 'install'
          ELSE am.movement_type
        END as job_type,

        am.created_at

      FROM ASSET_MOVEMENTS am
      JOIN ASSETS a ON am.asset_id = a.id
      LEFT JOIN locations asset_loc ON a.location_id = asset_loc.id
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN oems oem ON p.oem_id = oem.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN USER_MASTER assigned_user ON am.assigned_to = assigned_user.user_id
      LEFT JOIN DEPARTMENT_MASTER asset_dept ON a.department_id = asset_dept.department_id
      LEFT JOIN locations loc ON a.location_id = loc.id
      LEFT JOIN locations user_loc ON assigned_user.location_id = user_loc.id
      LEFT JOIN USER_MASTER prev_user ON am.previous_user_id = prev_user.user_id
      LEFT JOIN DEPARTMENT_MASTER prev_dept ON prev_user.department_id = prev_dept.department_id
      LEFT JOIN locations prev_loc ON am.previous_location_id = prev_loc.id
      LEFT JOIN USER_MASTER performer ON am.performed_by = performer.user_id

      WHERE 1=1 ${typeCondition} ${filterConditions}

      ORDER BY am.movement_date DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, parseInt(limit));

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ASSET_MOVEMENTS am
      JOIN ASSETS a ON am.asset_id = a.id
      LEFT JOIN locations asset_loc ON a.location_id = asset_loc.id
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN oems oem ON p.oem_id = oem.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN USER_MASTER assigned_user ON am.assigned_to = assigned_user.user_id
      LEFT JOIN DEPARTMENT_MASTER asset_dept ON a.department_id = asset_dept.department_id
      LEFT JOIN USER_MASTER prev_user ON am.previous_user_id = prev_user.user_id
      LEFT JOIN DEPARTMENT_MASTER prev_dept ON prev_user.department_id = prev_dept.department_id
      WHERE 1=1 ${typeCondition} ${filterConditions}
    `;

    const [dataResult, countResult] = await Promise.all([
      request.query(query),
      pool.request()
        .input('date_from', sql.Date, date_from || null)
        .input('date_to', sql.Date, date_to || null)
        .input('location_id', sql.UniqueIdentifier, location_id || null)
        .input('department_id', sql.UniqueIdentifier, department_id || null)
        .input('user_id', sql.UniqueIdentifier, user_id || null)
        .input('category_id', sql.UniqueIdentifier, category_id || null)
        .input('oem_id', sql.UniqueIdentifier, oem_id || null)
        .input('product_id', sql.UniqueIdentifier, product_id || null)
        .input('search', sql.VarChar(100), search ? `%${search}%` : null)
        .query(countQuery)
    ]);

    // Statistics query
    const statsQuery = `
      SELECT
        COUNT(CASE WHEN am.movement_type = 'assigned' AND am.previous_user_id IS NULL THEN 1 END) as install_count,
        COUNT(CASE WHEN am.movement_type = 'relocated' THEN 1 END) as move_count,
        COUNT(CASE WHEN am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL) THEN 1 END) as transfer_count,
        COUNT(*) as total_count
      FROM ASSET_MOVEMENTS am
      JOIN ASSETS a ON am.asset_id = a.id
      LEFT JOIN locations asset_loc ON a.location_id = asset_loc.id
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN USER_MASTER assigned_user ON am.assigned_to = assigned_user.user_id
      LEFT JOIN USER_MASTER prev_user ON am.previous_user_id = prev_user.user_id
      WHERE am.movement_type IN ('assigned', 'transferred', 'relocated')
      ${filterConditions.replace(/@/g, '@stats_')}
    `;

    const statsResult = await pool.request()
      .input('stats_date_from', sql.Date, date_from || null)
      .input('stats_date_to', sql.Date, date_to || null)
      .input('stats_location_id', sql.UniqueIdentifier, location_id || null)
      .input('stats_department_id', sql.UniqueIdentifier, department_id || null)
      .input('stats_user_id', sql.UniqueIdentifier, user_id || null)
      .input('stats_category_id', sql.UniqueIdentifier, category_id || null)
      .input('stats_oem_id', sql.UniqueIdentifier, oem_id || null)
      .input('stats_product_id', sql.UniqueIdentifier, product_id || null)
      .input('stats_search', sql.VarChar(100), search ? `%${search}%` : null)
      .query(statsQuery);

    sendSuccess(res, {
      reports: dataResult.recordset,
      statistics: statsResult.recordset[0] || {},
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.recordset[0]?.total || 0,
        totalPages: Math.ceil((countResult.recordset[0]?.total || 0) / parseInt(limit))
      }
    }, 'Asset job reports retrieved successfully');
  })
);

/**
 * GET /api/v1/asset-reports/job-reports/export/excel
 * Export job reports to Excel
 * NOTE: This route MUST be defined BEFORE /:id to prevent route parameter conflicts
 */
router.get('/export/excel',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const {
      report_type = 'all',
      date_from,
      date_to,
      location_id,
      department_id,
      user_id,
      category_id,
      oem_id,
      product_id,
      search
    } = req.query;

    const pool = await connectDB();

    // Build WHERE clause
    let typeCondition = '';
    switch (report_type) {
      case 'install':
        typeCondition = "AND am.movement_type = 'assigned' AND am.previous_user_id IS NULL";
        break;
      case 'move':
        typeCondition = "AND (am.movement_type = 'relocated' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NULL AND am.previous_location_id IS NOT NULL))";
        break;
      case 'transfer':
        typeCondition = "AND (am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL))";
        break;
      default:
        typeCondition = "AND am.movement_type IN ('assigned', 'transferred', 'relocated')";
    }

    let filterConditions = '';
    const request = pool.request();

    if (date_from) {
      filterConditions += ' AND CAST(am.movement_date AS DATE) >= @date_from';
      request.input('date_from', sql.Date, date_from);
    }
    if (date_to) {
      filterConditions += ' AND CAST(am.movement_date AS DATE) <= @date_to';
      request.input('date_to', sql.Date, date_to);
    }
    if (location_id) {
      filterConditions += ' AND am.location_id = @location_id';
      request.input('location_id', sql.UniqueIdentifier, location_id);
    }
    if (department_id) {
      filterConditions += ' AND (assigned_user.department_id = @department_id OR prev_user.department_id = @department_id)';
      request.input('department_id', sql.UniqueIdentifier, department_id);
    }
    if (user_id) {
      filterConditions += ' AND (am.assigned_to = @user_id OR am.previous_user_id = @user_id)';
      request.input('user_id', sql.UniqueIdentifier, user_id);
    }
    if (category_id) {
      filterConditions += ' AND p.category_id = @category_id';
      request.input('category_id', sql.UniqueIdentifier, category_id);
    }
    if (oem_id) {
      filterConditions += ' AND p.oem_id = @oem_id';
      request.input('oem_id', sql.UniqueIdentifier, oem_id);
    }
    if (product_id) {
      filterConditions += ' AND a.product_id = @product_id';
      request.input('product_id', sql.UniqueIdentifier, product_id);
    }
    if (search) {
      filterConditions += ` AND (
        a.asset_tag LIKE @search
        OR a.serial_number LIKE @search
        OR (assigned_user.first_name + ' ' + assigned_user.last_name) LIKE @search
      )`;
      request.input('search', sql.VarChar(100), `%${search}%`);
    }

    const result = await request.query(`
      SELECT
        FORMAT(am.movement_date, 'yyyy-MM-dd HH:mm') as [Date],
        CASE
          WHEN am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL)
            THEN 'Transfer'
          WHEN am.movement_type = 'relocated'
            THEN 'Move'
          WHEN am.movement_type = 'assigned' AND am.previous_user_id IS NULL
            THEN 'Install'
          ELSE am.movement_type
        END as [Job Type],
        a.asset_tag as [Asset Tag],
        a.serial_number as [Serial Number],
        p.name as [Product],
        p.model as [Model],
        oem.name as [OEM],
        cat.name as [Category],
        COALESCE(assigned_user.first_name + ' ' + assigned_user.last_name, am.assigned_to_name) as [Assigned To],
        assigned_user.employee_id as [Emp Code],
        assigned_dept.department_name as [Department],
        COALESCE(
          loc.name,
          asset_loc.name,
          am.location_name,
          user_loc.name
      ) AS location_name,
      
      COALESCE(
          loc.building,
          asset_loc.building,
          user_loc.building
      ) AS location_building,
      
      COALESCE(
          loc.floor,
          asset_loc.floor,
          user_loc.floor
      ) AS location_floor,
        COALESCE(prev_user.first_name + ' ' + prev_user.last_name, am.previous_user_name) as [Previous User],
        COALESCE(prev_loc.name, am.previous_location_name, prev_user_loc.name) as [Previous Location],
        COALESCE(performer.first_name + ' ' + performer.last_name, am.performed_by_name) as [Performed By],
        am.reason as [Reason],
        am.notes as [Notes]

      FROM ASSET_MOVEMENTS am
      JOIN ASSETS a ON am.asset_id = a.id
      LEFT JOIN locations asset_loc ON a.location_id = asset_loc.id
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN oems oem ON p.oem_id = oem.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN USER_MASTER assigned_user ON am.assigned_to = assigned_user.user_id
      LEFT JOIN DEPARTMENT_MASTER asset_dept ON a.department_id = asset_dept.department_id
      LEFT JOIN locations loc ON a.location_id = loc.id
      LEFT JOIN locations user_loc ON assigned_user.location_id = user_loc.id
      LEFT JOIN USER_MASTER prev_user ON am.previous_user_id = prev_user.user_id
      LEFT JOIN DEPARTMENT_MASTER prev_dept ON prev_user.department_id = prev_dept.department_id
      LEFT JOIN locations prev_loc ON am.previous_location_id = prev_loc.id
      LEFT JOIN locations prev_user_loc ON prev_user.location_id = prev_user_loc.id
      LEFT JOIN USER_MASTER performer ON am.performed_by = performer.user_id

      WHERE 1=1 ${typeCondition} ${filterConditions}
      ORDER BY am.movement_date DESC
    `);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Unified ITSM Platform';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Asset Job Reports');

    // Add headers
    const headers = [
      'Date', 'Job Type', 'Asset Tag', 'Serial Number', 'Product', 'Model',
      'OEM', 'Category', 'Assigned To', 'Emp Code', 'Department', 'Location',
      'Building', 'Floor', 'Previous User', 'Previous Location', 'Performed By',
      'Reason', 'Notes'
    ];

    worksheet.addRow(headers);

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1a365d' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data
    result.recordset.forEach(row => {
      worksheet.addRow([
        row['Date'],
        row['Job Type'],
        row['Asset Tag'],
        row['Serial Number'],
        row['Product'],
        row['Model'],
        row['OEM'],
        row['Category'],
        row['Assigned To'],
        row['Emp Code'],
        row['Department'],
        row['Location'],
        row['Building'],
        row['Floor'],
        row['Previous User'],
        row['Previous Location'],
        row['Performed By'],
        row['Reason'],
        row['Notes']
      ]);
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      column.width = 15;
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    const reportTypeTitle = {
      install: 'Install',
      move: 'Move',
      transfer: 'Transfer',
      all: 'All'
    };

    const filename = `IT_Asset_${reportTypeTitle[report_type]}_Job_Reports_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  })
);

/**
 * GET /api/v1/asset-reports/job-reports/:id
 * Get single job report details
 */
router.get('/:id',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          am.id as movement_id,
          am.movement_date,
          am.movement_type,
          am.status,
          am.reason,
          am.notes,

          -- Asset info
          a.id as asset_id,
          a.asset_tag,
          a.serial_number,
          a.purchase_date,
          a.warranty_end_date as warranty_expiry,
          p.name as product_name,
          p.model as product_model,
          oem.name as oem_name,
          cat.name as category_name,

          -- Current assignment
          am.assigned_to,
          COALESCE(assigned_user.first_name + ' ' + assigned_user.last_name, am.assigned_to_name) as assigned_to_name,
          assigned_user.email as assigned_to_email,
          assigned_user.employee_id as assigned_to_emp_code,
          NULL as assigned_to_phone,
          asset_dept.department_name as assigned_to_department,

          -- Current location (fallback: movement location -> user's location)
          am.location_id,
        asset_loc.name AS location_name,
        asset_loc.building AS location_building,
        asset_loc.floor AS location_floor,
          assigned_user.room_no as location_room_no,

          -- Previous user (for transfers)
          am.previous_user_id,
          COALESCE(prev_user.first_name + ' ' + prev_user.last_name, am.previous_user_name) as previous_user_name,
          prev_user.email as previous_user_email,
          prev_user.employee_id as previous_user_emp_code,
          NULL as previous_user_phone,
          prev_dept.department_name as previous_user_department,

          -- Previous location (fallback: movement previous location -> previous user's location)
          am.previous_location_id,
          COALESCE(prev_loc.name, am.previous_location_name, prev_user_loc.name) as previous_location_name,
          COALESCE(prev_loc.building, prev_user_loc.building) as previous_location_building,
          COALESCE(prev_loc.floor, prev_user_loc.floor) as previous_location_floor,
          prev_user.room_no as previous_location_room_no,

          -- Performed by
          am.performed_by,
          COALESCE(performer.first_name + ' ' + performer.last_name, am.performed_by_name) as performed_by_name,
          performer.email as performed_by_email,

          -- Computed report type
          CASE
            WHEN am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL)
              THEN 'transfer'
            WHEN am.movement_type = 'relocated'
              THEN 'move'
            WHEN am.movement_type = 'assigned' AND am.previous_user_id IS NULL
              THEN 'install'
            ELSE am.movement_type
          END as job_type,

          am.created_at

        FROM ASSET_MOVEMENTS am
        JOIN ASSETS a ON am.asset_id = a.id
        LEFT JOIN locations asset_loc ON a.location_id = asset_loc.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN oems oem ON p.oem_id = oem.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN USER_MASTER assigned_user ON am.assigned_to = assigned_user.user_id
        LEFT JOIN DEPARTMENT_MASTER asset_dept ON a.department_id = asset_dept.department_id
        LEFT JOIN locations loc ON a.location_id = loc.id
        LEFT JOIN locations user_loc ON assigned_user.location_id = user_loc.id
        LEFT JOIN USER_MASTER prev_user ON am.previous_user_id = prev_user.user_id
        LEFT JOIN DEPARTMENT_MASTER prev_dept ON prev_user.department_id = prev_dept.department_id
        LEFT JOIN locations prev_loc ON am.previous_location_id = prev_loc.id
        LEFT JOIN locations prev_user_loc ON prev_user.location_id = prev_user_loc.id
        LEFT JOIN USER_MASTER performer ON am.performed_by = performer.user_id

        WHERE am.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendError(res, 'Job report not found', 404);
    }

    sendSuccess(res, result.recordset[0], 'Job report retrieved successfully');
  })
);

/**
 * GET /api/v1/asset-reports/job-reports/:id/pdf
 * Download PDF for single job report
 */
router.get('/:id/pdf',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD, USER_ROLES.ENGINEER]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          am.id as movement_id,
          am.movement_date,
          am.movement_type,
          am.status,
          am.reason,
          am.notes,

          a.id as asset_id,
          a.asset_tag,
          a.serial_number,
          a.purchase_date,
          a.warranty_end_date as warranty_expiry,
          p.name as product_name,
          p.model as product_model,
          oem.name as oem_name,
          cat.name as category_name,

          am.assigned_to,
          COALESCE(assigned_user.first_name + ' ' + assigned_user.last_name, am.assigned_to_name) as assigned_to_name,
          assigned_user.email as assigned_to_email,
          assigned_user.employee_id as assigned_to_emp_code,
          NULL as assigned_to_phone,
          asset_dept.department_name as assigned_to_department,

          -- Current location (fallback: movement location -> user's location)
         am.location_id,
          asset_loc.name AS location_name,
          asset_loc.building AS location_building,
          asset_loc.floor AS location_floor,

          am.previous_user_id,
          COALESCE(prev_user.first_name + ' ' + prev_user.last_name, am.previous_user_name) as previous_user_name,
          prev_user.email as previous_user_email,
          prev_user.employee_id as previous_user_emp_code,
          NULL as previous_user_phone,
          prev_dept.department_name as previous_user_department,

          -- Previous location (fallback: movement previous location -> previous user's location)
          am.previous_location_id,
          COALESCE(prev_loc.name, am.previous_location_name, prev_user_loc.name) as previous_location_name,
          COALESCE(prev_loc.building, prev_user_loc.building) as previous_location_building,
          COALESCE(prev_loc.floor, prev_user_loc.floor) as previous_location_floor,

          am.performed_by,
          COALESCE(performer.first_name + ' ' + performer.last_name, am.performed_by_name) as performed_by_name,
          performer.email as performed_by_email,

          CASE
            WHEN am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL)
              THEN 'transfer'
            WHEN am.movement_type = 'relocated'
              THEN 'move'
            WHEN am.movement_type = 'assigned' AND am.previous_user_id IS NULL
              THEN 'install'
            ELSE am.movement_type
          END as job_type,

          am.created_at

        FROM ASSET_MOVEMENTS am
        JOIN ASSETS a ON am.asset_id = a.id
        LEFT JOIN locations asset_loc ON a.location_id = asset_loc.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN oems oem ON p.oem_id = oem.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN USER_MASTER assigned_user ON am.assigned_to = assigned_user.user_id
        LEFT JOIN DEPARTMENT_MASTER asset_dept ON a.department_id = asset_dept.department_id
        LEFT JOIN locations loc ON a.location_id = loc.id
        LEFT JOIN locations user_loc ON assigned_user.location_id = user_loc.id
        LEFT JOIN USER_MASTER prev_user ON am.previous_user_id = prev_user.user_id
        LEFT JOIN DEPARTMENT_MASTER prev_dept ON prev_user.department_id = prev_dept.department_id
        LEFT JOIN locations prev_loc ON am.previous_location_id = prev_loc.id
        LEFT JOIN locations prev_user_loc ON prev_user.location_id = prev_user_loc.id
        LEFT JOIN USER_MASTER performer ON am.performed_by = performer.user_id

        WHERE am.id = @id
      `);

    if (result.recordset.length === 0) {
      return sendError(res, 'Job report not found', 404);
    }

    const report = result.recordset[0];
    const pdfBuffer = await AssetJobReportPDF.generateSingleReport(report);

    const jobTypeTitle = {
      install: 'Install',
      move: 'Move',
      transfer: 'Transfer'
    };

    const filename = `IT_Asset_${jobTypeTitle[report.job_type] || 'Job'}_Report_${report.asset_tag}_${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  })
);

/**
 * POST /api/v1/asset-reports/job-reports/pdf/bulk
 * Download bulk PDF for multiple job reports
 */
router.post('/pdf/bulk',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const { report_ids } = req.body;

    if (!report_ids || !Array.isArray(report_ids) || report_ids.length === 0) {
      return sendError(res, 'report_ids array is required', 400);
    }

    const pool = await connectDB();

    // Build parameterized query for UUIDs
    const request = pool.request();
    report_ids.forEach((id, i) => {
      request.input(`id${i}`, sql.UniqueIdentifier, id);
    });

    const result = await request.query(`
        SELECT
          am.id as movement_id,
          am.movement_date,
          am.movement_type,
          am.status,
          am.reason,
          am.notes,

          a.id as asset_id,
          a.asset_tag,
          a.serial_number,
          a.purchase_date,
          a.warranty_end_date as warranty_expiry,
          p.name as product_name,
          p.model as product_model,
          oem.name as oem_name,
          cat.name as category_name,

          am.assigned_to,
          COALESCE(assigned_user.first_name + ' ' + assigned_user.last_name, am.assigned_to_name) as assigned_to_name,
          assigned_user.email as assigned_to_email,
          assigned_user.employee_id as assigned_to_emp_code,
          NULL as assigned_to_phone,
          asset_dept.department_name as assigned_to_department,

          -- Current location (fallback: movement location -> user's location)
          am.location_id,
          loc.name as location_name,
          loc.building as location_building,
          loc.floor as location_floor,

          am.previous_user_id,
          COALESCE(prev_user.first_name + ' ' + prev_user.last_name, am.previous_user_name) as previous_user_name,
          prev_user.email as previous_user_email,
          prev_user.employee_id as previous_user_emp_code,
          NULL as previous_user_phone,
          prev_dept.department_name as previous_user_department,

          -- Previous location (fallback: movement previous location -> previous user's location)
          am.previous_location_id,
          COALESCE(prev_loc.name, am.previous_location_name, prev_user_loc.name) as previous_location_name,
          COALESCE(prev_loc.building, prev_user_loc.building) as previous_location_building,
          COALESCE(prev_loc.floor, prev_user_loc.floor) as previous_location_floor,

          am.performed_by,
          COALESCE(performer.first_name + ' ' + performer.last_name, am.performed_by_name) as performed_by_name,
          performer.email as performed_by_email,

          CASE
            WHEN am.movement_type = 'transferred' OR (am.movement_type = 'assigned' AND am.previous_user_id IS NOT NULL)
              THEN 'transfer'
            WHEN am.movement_type = 'relocated'
              THEN 'move'
            WHEN am.movement_type = 'assigned' AND am.previous_user_id IS NULL
              THEN 'install'
            ELSE am.movement_type
          END as job_type,

          am.created_at

        FROM ASSET_MOVEMENTS am
        JOIN ASSETS a ON am.asset_id = a.id
        LEFT JOIN locations asset_loc ON a.location_id = asset_loc.id
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN oems oem ON p.oem_id = oem.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN USER_MASTER assigned_user ON am.assigned_to = assigned_user.user_id
        LEFT JOIN DEPARTMENT_MASTER asset_dept ON a.department_id = asset_dept.department_id
        LEFT JOIN locations loc ON a.location_id = loc.id
        LEFT JOIN locations user_loc ON assigned_user.location_id = user_loc.id
        LEFT JOIN USER_MASTER prev_user ON am.previous_user_id = prev_user.user_id
        LEFT JOIN DEPARTMENT_MASTER prev_dept ON prev_user.department_id = prev_dept.department_id
        LEFT JOIN locations prev_loc ON am.previous_location_id = prev_loc.id
        LEFT JOIN locations prev_user_loc ON prev_user.location_id = prev_user_loc.id
        LEFT JOIN USER_MASTER performer ON am.performed_by = performer.user_id

        WHERE am.id IN (${report_ids.map((_, i) => `@id${i}`).join(',')})
        ORDER BY am.movement_date DESC
      `);

    if (result.recordset.length === 0) {
      return sendError(res, 'No reports found', 404);
    }

    const pdfBuffer = await AssetJobReportPDF.generateBulkReport(result.recordset);
    const filename = `IT_Asset_Job_Reports_Bulk_${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  })
);

module.exports = router;
