/**
 * Gate Pass Management Routes
 * Handles gate pass creation, management, and PDF generation for:
 * - Disposal/Service: Assets going out for scrap, buyback, or repair
 * - End User: Assets leaving with/to end users
 */

const express = require('express');
const router = express.Router();
const { connectDB, sql } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { asyncHandler } = require('../middleware/error-handler');
const { sendSuccess, sendError } = require('../utils/response');
const { roles: USER_ROLES } = require('../config/auth');
const { v4: uuidv4 } = require('uuid');
const GatePassPDF = require('../utils/gatePassPDF');

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * Generate gate pass number: GP-YYYYMMDD-XXXX
 */
async function generateGatePassNumber(pool) {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  const result = await pool.request().query(`
    SELECT NEXT VALUE FOR GatePassSequence AS seq_num
  `);

  const seqNum = result.recordset[0].seq_num.toString().padStart(4, '0');
  return `GP-${dateStr}-${seqNum}`;
}

/**
 * GET /api/v1/gate-passes
 * List all gate passes with filters
 */
router.get('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const {
      gate_pass_type,
      date_from,
      date_to,
      vendor_id,
      recipient_user_id,
      search,
      serial_number,
      page = 1,
      limit = 20
    } = req.query;

    const pool = await connectDB();
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let filterConditions = '';
    const request = pool.request();

    if (gate_pass_type) {
      filterConditions += ' AND gp.gate_pass_type = @gate_pass_type';
      request.input('gate_pass_type', sql.VarChar(20), gate_pass_type);
    }

    if (date_from) {
      filterConditions += ' AND gp.created_at >= @date_from';
      request.input('date_from', sql.Date, date_from);
    }

    if (date_to) {
      filterConditions += ' AND gp.created_at <= @date_to';
      request.input('date_to', sql.Date, date_to);
    }

    if (vendor_id) {
      filterConditions += ' AND gp.vendor_id = @vendor_id';
      request.input('vendor_id', sql.UniqueIdentifier, vendor_id);
    }

    if (recipient_user_id) {
      filterConditions += ' AND gp.recipient_user_id = @recipient_user_id';
      request.input('recipient_user_id', sql.UniqueIdentifier, recipient_user_id);
    }

    if (search) {
      filterConditions += ` AND (
        gp.gate_pass_number LIKE @search
        OR gp.vendor_name LIKE @search
        OR gp.recipient_name LIKE @search
        OR EXISTS (SELECT 1 FROM GATE_PASS_ASSETS gpa WHERE gpa.gate_pass_id = gp.id AND gpa.asset_tag LIKE @search)
      )`;
      request.input('search', sql.VarChar(100), `%${search}%`);
    }

    if (serial_number) {
      filterConditions += ` AND EXISTS (SELECT 1 FROM GATE_PASS_ASSETS gpa WHERE gpa.gate_pass_id = gp.id AND gpa.serial_number LIKE @serial_number)`;
      request.input('serial_number', sql.VarChar(100), `%${serial_number}%`);
    }

    // Main query
    // const query = `
    //   SELECT
    //     gp.id,
    //     gp.gate_pass_number,
    //     gp.gate_pass_type,
    //     gp.purpose,
    //     gp.from_location_name,
    //     gp.vendor_name,
    //     gp.destination_address,
    //     gp.recipient_name,
    //     gp.recipient_department,
    //     gp.authorized_by_name,
    //     gp.issue_date,
    //     gp.valid_until,
    //     gp.created_by_name,
    //     gp.created_at,
    //     gp.carrier_name,
    //     (SELECT COUNT(*) FROM GATE_PASS_ASSETS WHERE gate_pass_id = gp.id) as asset_count
    //   FROM GATE_PASSES gp
    //   WHERE 1=1 ${filterConditions}
    //   ORDER BY gp.created_at DESC
    //   OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    // `;

    const query = `
      SELECT

          gp.id,
          gp.gate_pass_number,
      
          gpa.asset_tag,
          gpa.serial_number,
      
          gpa.category_name,
          gpa.subcategory_name,
      
          gpa.product_name,
          gpa.model,
      
          gp.gate_pass_type,
          gp.purpose,
      
          gp.from_location_name,
      
          gp.vendor_name,
          gp.destination_address,
      
          gp.recipient_name,
          gp.recipient_department,
      
          gp.authorized_by_name,
      
          gp.issue_date,
          gp.valid_until,
      
          gp.created_by_name,
          gp.created_at,
      
          gp.carrier_name,
      
          (
              SELECT COUNT(*)
              FROM GATE_PASS_ASSETS
              WHERE gate_pass_id = gp.id
          ) AS asset_count
      
      FROM GATE_PASSES gp

    OUTER APPLY
    (
        SELECT TOP 1
    
            gpa.asset_tag,
            gpa.serial_number,
    
            p.name AS product_name,
            p.model,
    
            c.name AS category_name,
            sc.name AS subcategory_name
    
        FROM GATE_PASS_ASSETS gpa
    
        LEFT JOIN ASSETS a
            ON a.id = gpa.asset_id
    
        LEFT JOIN PRODUCTS p
            ON a.product_id = p.id
    
        LEFT JOIN CATEGORIES c
            ON p.category_id = c.id
    
        LEFT JOIN CATEGORIES sc
            ON p.subcategory_id = sc.id
    
        WHERE gpa.gate_pass_id = gp.id
    
        ORDER BY gpa.asset_tag
    
    ) gpa

    WHERE 1=1
    ${filterConditions}
    
    ORDER BY gp.created_at DESC
    OFFSET @offset ROWS
    FETCH NEXT @limit ROWS ONLY;
    `;

    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, parseInt(limit));

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM GATE_PASSES gp
      WHERE 1=1 ${filterConditions}
    `;

    const [dataResult, countResult] = await Promise.all([
      request.query(query),
      pool.request()
        .input('gate_pass_type', sql.VarChar(20), gate_pass_type || null)
        .input('date_from', sql.Date, date_from || null)
        .input('date_to', sql.Date, date_to || null)
        .input('vendor_id', sql.UniqueIdentifier, vendor_id || null)
        .input('recipient_user_id', sql.UniqueIdentifier, recipient_user_id || null)
        .input('search', sql.VarChar(100), search ? `%${search}%` : null)
        .input('serial_number', sql.VarChar(100), serial_number ? `%${serial_number}%` : null)
        .query(countQuery)
    ]);

    // Statistics
    const statsQuery = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN gate_pass_type = 'disposal_service' THEN 1 ELSE 0 END) as disposal_service_count,
        SUM(CASE WHEN gate_pass_type = 'end_user' THEN 1 ELSE 0 END) as end_user_count
      FROM GATE_PASSES
    `;

    const statsResult = await pool.request().query(statsQuery);

    sendSuccess(res, {
      gate_passes: dataResult.recordset,
      statistics: statsResult.recordset[0] || {},
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.recordset[0]?.total || 0,
        totalPages: Math.ceil((countResult.recordset[0]?.total || 0) / parseInt(limit))
      }
    }, 'Gate passes retrieved successfully');
  })
);

/**
 * GET /api/v1/gate-passes/assets/search
 * Search assets for gate pass creation
 */
router.get('/assets/search',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const { search, limit = 20 } = req.query;

    if (!search || search.length < 2) {
      return sendSuccess(res, [], 'Enter at least 2 characters to search');
    }

    const pool = await connectDB();

    const result = await pool.request()
      .input('search', sql.VarChar(100), `%${search}%`)
      .input('limit', sql.Int, parseInt(limit))
      .query(`
        SELECT TOP (@limit)
          a.id,
          a.asset_tag,
          a.serial_number,
          a.status,
          a.condition_status,
          a.asset_type,
          a.parent_asset_id,
          p.name as product_name,
          p.model,
          oem.name as oem_name,
          cat.name as category_name,
          u.first_name + ' ' + u.last_name as assigned_to_name,
          u.employee_id as assigned_to_emp_id,
          l.id as location_id,
          l.name as location_name,
          l.building,
          l.floor,
          l.address as location_address,
          l.city_name,
          l.state_name,
          -- Check if this is a parent asset
          (SELECT COUNT(*) FROM ASSETS WHERE parent_asset_id = a.id) as component_count
        FROM ASSETS a
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN oems oem ON p.oem_id = oem.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN locations l ON a.location_id = l.id
        WHERE (a.asset_tag LIKE @search OR a.serial_number LIKE @search OR p.name LIKE @search)
          AND a.is_active = 1
          AND a.status NOT IN ('disposed', 'scrapped')
        ORDER BY a.asset_tag
      `);

    sendSuccess(res, result.recordset, 'Assets retrieved successfully');
  })
);

/**
 * GET /api/v1/gate-passes/users/:userId/assets
 * Get assets assigned to selected user
 */
router.get(
  '/users/:userId/assets',
  requireRole([
    USER_ROLES.ADMIN,
    USER_ROLES.SUPERADMIN,
    USER_ROLES.COORDINATOR,
    USER_ROLES.IT_HEAD
  ]),
  asyncHandler(async (req, res) => {

    const { userId } = req.params;

    const pool = await connectDB();

    const result = await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .query(`
        SELECT
            a.id,
            a.asset_tag,
            a.serial_number,
            a.status,
            a.condition_status,
            a.asset_type,
            a.parent_asset_id,

            p.name as product_name,
            p.model,

            oem.name as oem_name,
            cat.name as category_name,

            u.first_name + ' ' + u.last_name as assigned_to_name,

            l.id as location_id,
            l.name as location_name,

            (
                SELECT COUNT(*)
                FROM ASSETS
                WHERE parent_asset_id = a.id
            ) as component_count

        FROM ASSETS a

        LEFT JOIN products p
            ON a.product_id = p.id

        LEFT JOIN oems oem
            ON p.oem_id = oem.id

        LEFT JOIN categories cat
            ON p.category_id = cat.id

        LEFT JOIN USER_MASTER u
            ON a.assigned_to = u.user_id

        LEFT JOIN locations l
            ON u.location_id = l.id

        WHERE
            a.assigned_to = @userId
            AND a.is_active = 1
            AND a.status NOT IN ('disposed','scrapped')

        ORDER BY a.asset_tag
      `);

    sendSuccess(res, result.recordset);

  })
);


/**
 * GET /api/v1/gate-passes/assets/:assetId/with-components
 * Get asset with its components (for parent assets)
 */
router.get('/assets/:assetId/with-components',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const { assetId } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('assetId', sql.UniqueIdentifier, assetId)
      .query(`
        SELECT
          a.id,
          a.asset_tag,
          a.serial_number,
          a.status,
          a.condition_status,
          a.asset_type,
          a.parent_asset_id,
          p.name as product_name,
          p.model,
          oem.name as oem_name,
          cat.name as category_name,
          u.first_name + ' ' + u.last_name as assigned_to_name,
          l.id as location_id,
          l.name as location_name,
          l.building,
          l.floor,
          l.address as location_address,
          l.city_name,
          l.state_name,
          CASE WHEN a.parent_asset_id IS NULL AND EXISTS(SELECT 1 FROM ASSETS WHERE parent_asset_id = a.id) THEN 1 ELSE 0 END as is_parent
        FROM ASSETS a
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN oems oem ON p.oem_id = oem.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN locations l ON a.location_id = l.id
        WHERE a.id = @assetId OR a.parent_asset_id = @assetId
        ORDER BY
          CASE WHEN a.id = @assetId THEN 0 ELSE 1 END,
          a.asset_tag
      `);

    if (result.recordset.length === 0) {
      return sendError(res, 'Asset not found', 404);
    }

    // Separate parent and components
    const parent = result.recordset.find(a => a.id === assetId);
    const components = result.recordset.filter(a => a.parent_asset_id === assetId);

    sendSuccess(res, {
      asset: parent,
      components: components,
      has_components: components.length > 0
    }, 'Asset with components retrieved successfully');
  })
);

/**
 * POST /api/v1/gate-passes
 * Create new gate pass
 */
router.post('/',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD]),
  asyncHandler(async (req, res) => {
    const {
      gate_pass_type,
      purpose,
      assets, // Array of { asset_id, condition_out, remarks, include_components }

      // Disposal/Service fields
      vendor_id,
      destination_address,
      service_description,
      expected_return_date,
      carrier_name,

      // End User fields
      recipient_user_id,

      // Common fields
      authorized_by,
      issue_date,
      valid_until,
      remarks
    } = req.body;

    // Validation
    if (!gate_pass_type || !['disposal_service', 'end_user'].includes(gate_pass_type)) {
      return sendError(res, 'Invalid gate pass type', 400);
    }

    if (!purpose) {
      return sendError(res, 'Purpose is required', 400);
    }

    // Old code to require at least one asset for all gate pass types
    // if (!assets || !Array.isArray(assets) || assets.length === 0) {
    //   return sendError(res, 'At least one asset is required', 400);
    // }

    // For without asset gate pass, assets can be empty if proceed_without_asset is true
    if (
      (!assets || !Array.isArray(assets) || assets.length === 0) &&
      !req.body.proceed_without_asset
    ) {
      return sendError(res, 'At least one asset is required', 400);
    }

    if (gate_pass_type === 'end_user' && !recipient_user_id) {
      return sendError(res, 'Recipient user is required for end user gate pass', 400);
    }

    const pool = await connectDB();
    const transaction = pool.transaction();

    try {
      await transaction.begin();

      // Generate gate pass number
      const gatePassNumber = await generateGatePassNumber(pool);
      const gatePassId = uuidv4();

      // Get creator info
      const creatorResult = await transaction.request()
        .input('user_id', sql.UniqueIdentifier, req.user.id)
        .query('SELECT first_name, last_name FROM USER_MASTER WHERE user_id = @user_id');

      const creatorName = creatorResult.recordset[0]
        ? `${creatorResult.recordset[0].first_name} ${creatorResult.recordset[0].last_name}`
        : 'Unknown';

     // Old code  Get first asset's location as from_location
      // const firstAssetLocation = await transaction.request()
      //   .input('asset_id', sql.UniqueIdentifier, assets[0].asset_id)
      //   .query(`
      //     SELECT
      //       l.id as location_id,
      //       l.name as location_name,
      //       CONCAT(l.address, ', ', l.city_name, ', ', l.state_name) as location_address
      //     FROM ASSETS a
      //     LEFT JOIN USER_MASTER u ON a.assigned_to = u.user_id
      //     LEFT JOIN locations l ON u.location_id = l.id
      //     WHERE a.id = @asset_id
      //   `);

      // const fromLocation = firstAssetLocation.recordset[0] || {};


      // New code to handle case when no assets are provided (proceed_without_asset = true)
      let fromLocation = {};

      if (assets && assets.length > 0) {

        const firstAssetLocation = await transaction.request()
            .input('asset_id', sql.UniqueIdentifier, assets[0].asset_id)
            .query(`
              SELECT
                l.id as location_id,
                l.name as location_name,
                CONCAT(l.address, ', ', l.city_name, ', ', l.state_name) as location_address
              FROM ASSETS a
              LEFT JOIN locations l
                ON a.location_id = l.id
              WHERE a.id = @asset_id
            `);

        fromLocation = firstAssetLocation.recordset[0] || {};
      }
      // Get vendor info if disposal/service
      let vendorName = null;
      if (gate_pass_type === 'disposal_service' && vendor_id) {
        const vendorResult = await transaction.request()
          .input('vendor_id', sql.UniqueIdentifier, vendor_id)
          .query('SELECT name FROM vendors WHERE id = @vendor_id');
        vendorName = vendorResult.recordset[0]?.name;
      }

      // Get recipient info if end_user
      let recipientInfo = {};
      if (gate_pass_type === 'end_user' && recipient_user_id) {
        // const recipientResult = await transaction.request()
        //   .input('user_id', sql.UniqueIdentifier, recipient_user_id)
        //   .query(`
        //     SELECT
        //       u.first_name + ' ' + u.last_name as name,
        //       u.employee_id,
        //       u.email,
        //       d.department_name,
        //       l.name as location_name
        //     FROM USER_MASTER u
        //     LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        //     LEFT JOIN locations l ON u.location_id = l.id
        //     WHERE u.user_id = @user_id
        //   `);

        // const recipientResult = await transaction.request()
        //   .input('user_id', sql.UniqueIdentifier, recipient_user_id)
        //   .query(`
        //     SELECT TOP 1
        //       u.first_name + ' ' + u.last_name AS name,
        //       u.employee_id,
        //       u.email,
          
        //       dm.department_name,
        //       l.name AS location_name,
        //       l.floor AS floor_name
          
        //   FROM USER_MASTER u
          
        //   LEFT JOIN ASSETS a
        //       ON a.assigned_to = u.user_id
          
        //   LEFT JOIN DEPARTMENT_MASTER dm
        //       ON a.department_id = dm.department_id
          
        //   LEFT JOIN locations l
        //       ON a.location_id = l.id

        //       WHERE u.user_id = @user_id
        //       ORDER BY a.updated_at DESC
        //   `);

        const recipientResult = await transaction.request()
  .input('user_id', sql.UniqueIdentifier, recipient_user_id)
  .input('asset_id', sql.UniqueIdentifier, assets[0].asset_id)
  .query(`
    SELECT
      u.first_name + ' ' + u.last_name AS name,
      u.employee_id,
      u.email,
      dm.department_name,
      l.name AS location_name,
      l.floor AS floor_name
    FROM USER_MASTER u
    INNER JOIN ASSETS a
      ON a.id = @asset_id
    LEFT JOIN DEPARTMENT_MASTER dm
      ON a.department_id = dm.department_id
    LEFT JOIN locations l
      ON a.location_id = l.id
    WHERE u.user_id = @user_id
  `);

        
        recipientInfo = recipientResult.recordset[0] || {};
        recipientInfo.floor = recipientInfo.floor_name;
        console.log("Recipient Query Result:", recipientResult.recordset[0]);
        console.log("Recipient Info:", recipientInfo);
        
        // Use asset location instead of user location
          if (fromLocation.location_name) {
            recipientInfo.location_name = fromLocation.location_name;
          }
      }

      // Get authorizer info
      let authorizerName = null;
      if (authorized_by) {
        const authResult = await transaction.request()
          .input('user_id', sql.UniqueIdentifier, authorized_by)
          .query('SELECT first_name + \' \' + last_name as name FROM USER_MASTER WHERE user_id = @user_id');
        authorizerName = authResult.recordset[0]?.name;
      }

        console.log("Saving Floor:", recipientInfo.floor);
      // Insert gate pass
      await transaction.request()
        .input('id', sql.UniqueIdentifier, gatePassId)
        .input('gate_pass_number', sql.VarChar(50), gatePassNumber)
        .input('gate_pass_type', sql.VarChar(20), gate_pass_type)
        .input('purpose', sql.VarChar(50), purpose)
        .input('from_location_id', sql.UniqueIdentifier, fromLocation.location_id || null)
        .input('from_location_name', sql.NVarChar(200), fromLocation.location_name || null)
        .input('from_location_address', sql.NVarChar(500), fromLocation.location_address || null)
        .input('recipient_floor',sql.NVarChar(100),recipientInfo.floor || null)
        .input('vendor_id', sql.UniqueIdentifier, vendor_id || null)
        .input('vendor_name', sql.NVarChar(200), vendorName)
        .input('destination_address', sql.NVarChar(500), destination_address || null)
        .input('service_description', sql.NVarChar(sql.MAX), service_description || null)
        .input('expected_return_date', sql.Date, expected_return_date || null)
        .input('recipient_user_id', sql.UniqueIdentifier, recipient_user_id || null)
        .input('recipient_name', sql.NVarChar(200), recipientInfo.name || null)
        .input('recipient_employee_id', sql.VarChar(50), recipientInfo.employee_id || null)
        .input('recipient_email', sql.VarChar(200), recipientInfo.email || null)
        .input('recipient_department', sql.NVarChar(200), recipientInfo.department_name || null)
        .input('recipient_location', sql.NVarChar(200), recipientInfo.location_name || null)
        .input('authorized_by', sql.UniqueIdentifier, authorized_by || null)
        .input('authorized_by_name', sql.NVarChar(200), authorizerName)
        .input('issue_date', sql.Date, issue_date || null)
        .input('valid_until', sql.Date, valid_until || null)
        .input('remarks', sql.NVarChar(sql.MAX), remarks || null)
        .input('created_by', sql.UniqueIdentifier, req.user.id)
        .input('created_by_name', sql.NVarChar(200), creatorName)
        .input('carrier_name', sql.NVarChar(200), carrier_name || null)
        .query(`
          INSERT INTO GATE_PASSES (
            id, gate_pass_number, gate_pass_type, purpose,
            from_location_id, from_location_name, from_location_address,
            vendor_id, vendor_name, destination_address, service_description, expected_return_date,
            recipient_user_id, recipient_name, recipient_employee_id, recipient_email, recipient_department, recipient_location,recipient_floor,
            authorized_by, authorized_by_name, issue_date, valid_until, remarks,
            created_by, created_by_name, carrier_name
          ) VALUES (
            @id, @gate_pass_number, @gate_pass_type, @purpose,
            @from_location_id, @from_location_name, @from_location_address,
            @vendor_id, @vendor_name, @destination_address, @service_description, @expected_return_date,
            @recipient_user_id, @recipient_name, @recipient_employee_id, @recipient_email, @recipient_department, @recipient_location,@recipient_floor,
            @authorized_by, @authorized_by_name, @issue_date, @valid_until, @remarks,
            @created_by, @created_by_name, @carrier_name
          )
        `);

      // Insert assets with their components
      for (const assetItem of assets) {
        // Get asset details
        const assetResult = await transaction.request()
          .input('asset_id', sql.UniqueIdentifier, assetItem.asset_id)
          .query(`
            SELECT
                a.id,
                a.asset_tag,
                a.serial_number,
            
                p.name AS product_name,
                p.model,
            
                cat.name AS category_name,
                subcat.name AS subcategory_name,
            
                oem.name AS oem_name,
            
                (
                    SELECT COUNT(*)
                    FROM ASSETS
                    WHERE parent_asset_id = a.id
                ) AS component_count
            FROM ASSETS a
            LEFT JOIN products p ON a.product_id = p.id
            LEFT JOIN categories cat ON p.category_id = cat.id
            LEFT JOIN categories subcat
    ON p.subcategory_id = subcat.id
            LEFT JOIN oems oem ON p.oem_id = oem.id
            WHERE a.id = @asset_id
          `);

        if (assetResult.recordset.length === 0) continue;

        const asset = assetResult.recordset[0];
        const isParent = asset.component_count > 0;

        // Insert main asset
        await transaction.request()
          .input('id', sql.UniqueIdentifier, uuidv4())
          .input('gate_pass_id', sql.UniqueIdentifier, gatePassId)
          .input('asset_id', sql.UniqueIdentifier, asset.id)
          .input('asset_tag', sql.VarChar(50), asset.asset_tag)
          .input('serial_number', sql.VarChar(100), asset.serial_number)
          .input('product_name', sql.NVarChar(200), asset.product_name)
          .input('model', sql.NVarChar(100), asset.model)
          .input('category_name', sql.NVarChar(100), asset.category_name)
          .input('oem_name', sql.NVarChar(100), asset.oem_name)
          .input('is_parent_asset', sql.Bit, isParent ? 1 : 0)
          .input('parent_asset_id', sql.UniqueIdentifier, asset.parent_asset_id)
          .input('condition_out', sql.VarChar(50), assetItem.condition_out || 'working')
          .input('remarks', sql.NVarChar(500), assetItem.remarks || null)
          .query(`
            INSERT INTO GATE_PASS_ASSETS (
              id, gate_pass_id, asset_id, asset_tag, serial_number,
              product_name, model, category_name, oem_name,
              is_parent_asset, parent_asset_id, condition_out, remarks
            ) VALUES (
              @id, @gate_pass_id, @asset_id, @asset_tag, @serial_number,
              @product_name, @model, @category_name, @oem_name,
              @is_parent_asset, @parent_asset_id, @condition_out, @remarks
            )
          `);

        // If include_components and this is a parent asset, add components
        if (assetItem.include_components && isParent) {
          const componentsResult = await transaction.request()
            .input('parent_id', sql.UniqueIdentifier, asset.id)
            .query(`
              SELECT
                a.id, a.asset_tag, a.serial_number, a.parent_asset_id,
                p.name as product_name, p.model,
                cat.name as category_name,
                oem.name as oem_name
              FROM ASSETS a
              LEFT JOIN products p ON a.product_id = p.id
              LEFT JOIN categories cat ON p.category_id = cat.id
              LEFT JOIN oems oem ON p.oem_id = oem.id
              WHERE a.parent_asset_id = @parent_id
            `);

          for (const comp of componentsResult.recordset) {
            await transaction.request()
              .input('id', sql.UniqueIdentifier, uuidv4())
              .input('gate_pass_id', sql.UniqueIdentifier, gatePassId)
              .input('asset_id', sql.UniqueIdentifier, comp.id)
              .input('asset_tag', sql.VarChar(50), comp.asset_tag)
              .input('serial_number', sql.VarChar(100), comp.serial_number)
              .input('product_name', sql.NVarChar(200), comp.product_name)
              .input('model', sql.NVarChar(100), comp.model)
              .input('category_name', sql.NVarChar(100), comp.category_name)
              .input('oem_name', sql.NVarChar(100), comp.oem_name)
              .input('is_parent_asset', sql.Bit, 0)
              .input('parent_asset_id', sql.UniqueIdentifier, comp.parent_asset_id)
              .input('condition_out', sql.VarChar(50), assetItem.condition_out || 'working')
              .input('remarks', sql.NVarChar(500), null)
              .query(`
                INSERT INTO GATE_PASS_ASSETS (
                  id, gate_pass_id, asset_id, asset_tag, serial_number,
                  product_name, model, category_name, oem_name,
                  is_parent_asset, parent_asset_id, condition_out, remarks
                ) VALUES (
                  @id, @gate_pass_id, @asset_id, @asset_tag, @serial_number,
                  @product_name, @model, @category_name, @oem_name,
                  @is_parent_asset, @parent_asset_id, @condition_out, @remarks
                )
              `);
          }
        }
      }

      await transaction.commit();

      sendSuccess(res, {
        id: gatePassId,
        gate_pass_number: gatePassNumber
      }, 'Gate pass created successfully', 201);

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  })
);


const XLSX = require('xlsx');

router.get(
  '/export',
  requireRole([
    USER_ROLES.ADMIN,
    USER_ROLES.SUPERADMIN,
    USER_ROLES.COORDINATOR,
    USER_ROLES.IT_HEAD
  ]),
  asyncHandler(async (req, res) => {

    const {
      gate_pass_type,
      date_from,
      date_to,
      search,
      serial_number
    } = req.query;

    const pool = await connectDB();

    let filter = "WHERE 1=1";
    const request = pool.request();

    if (gate_pass_type) {
      filter += " AND gp.gate_pass_type=@gate_pass_type";
      request.input("gate_pass_type", sql.VarChar, gate_pass_type);
    }

    if (date_from) {
      filter += " AND CAST(gp.created_at AS DATE)>=@date_from";
      request.input("date_from", sql.Date, date_from);
    }

    if (date_to) {
      filter += " AND CAST(gp.created_at AS DATE)<=@date_to";
      request.input("date_to", sql.Date, date_to);
    }

    if (search) {
      filter += `
      AND (
          gp.gate_pass_number LIKE @search
          OR gp.vendor_name LIKE @search
          OR gp.recipient_name LIKE @search
      )`;
      request.input("search", sql.VarChar, `%${search}%`);
    }

    if (serial_number) {
      filter += " AND gpa.serial_number LIKE @serial_number";
      request.input("serial_number", sql.VarChar, `%${serial_number}%`);
    }

    const result = await request.query(`
        SELECT
    gp.gate_pass_number AS [Gate Pass No.],

    gpa.asset_tag       AS [Asset Tag],
    gpa.serial_number   AS [Serial Number],

    c.name              AS [Category],
    sc.name             AS [Sub Category],

    p.name              AS [Product],
    p.model             AS [Model],

    CASE
        WHEN gp.gate_pass_type='disposal_service'
            THEN 'Disposal / Service'
        ELSE 'End User'
    END AS [Type],

    CASE gp.purpose
        WHEN 'repair' THEN 'External Repair'
        WHEN 'buyback' THEN 'Buyback / Sale'
        WHEN 'scrap' THEN 'Scrap / Disposal'
        WHEN 'new_assignment' THEN 'New Assignment'
        WHEN 'temporary_handover' THEN 'Temporary Handover'
        WHEN 'permanent_transfer' THEN 'Permanent Transfer'
        WHEN 'repair_return' THEN 'Repair and Return'
        ELSE gp.purpose
    END AS [Purpose],

    gp.from_location_name AS [From],

    CASE
        WHEN gp.gate_pass_type='disposal_service'
            THEN gp.vendor_name
        ELSE gp.recipient_name
    END AS [To],

    (
        SELECT COUNT(*)
        FROM GATE_PASS_ASSETS x
        WHERE x.gate_pass_id = gp.id
    ) AS [Assets],

    CONVERT(varchar(11), gp.created_at, 106) AS [Created Date]

FROM GATE_PASSES gp

LEFT JOIN GATE_PASS_ASSETS gpa
       ON gp.id = gpa.gate_pass_id

LEFT JOIN ASSETS a
       ON gpa.asset_id = a.id

LEFT JOIN PRODUCTS p
       ON a.product_id = p.id

LEFT JOIN CATEGORIES c
       ON p.category_id = c.id

LEFT JOIN CATEGORIES sc
       ON p.subcategory_id = sc.id
${filter}
ORDER BY gp.created_at DESC;
    `);

    const workbook = XLSX.utils.book_new();

    const worksheet = XLSX.utils.json_to_sheet(result.recordset);

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Gate Passes"
    );

    const buffer = XLSX.write(workbook,{
        type:"buffer",
        bookType:"xlsx"
    });

    res.setHeader(
        "Content-Disposition",
        "attachment; filename=GatePasses.xlsx"
    );

    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(buffer);

}));


/**
 * GET /api/v1/gate-passes/:id
 * Get single gate pass details
 */
router.get('/:id',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD, USER_ROLES.ENGINEER]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    // Get gate pass
    const gatePassResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          gp.*,
          v.code as vendor_code
        FROM GATE_PASSES gp
        LEFT JOIN vendors v ON gp.vendor_id = v.id
        WHERE gp.id = @id
      `);

    if (gatePassResult.recordset.length === 0) {
      return sendError(res, 'Gate pass not found', 404);
    }

    // Get assets
    const assetsResult = await pool.request()
      .input('gate_pass_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT
          gpa.*,
          a.status as current_status,
          a.condition_status as current_condition
        FROM GATE_PASS_ASSETS gpa
        LEFT JOIN ASSETS a ON gpa.asset_id = a.id
        WHERE gpa.gate_pass_id = @gate_pass_id
        ORDER BY
          CASE WHEN gpa.parent_asset_id IS NULL THEN 0 ELSE 1 END,
          gpa.asset_tag
      `);

    sendSuccess(res, {
      ...gatePassResult.recordset[0],
      assets: assetsResult.recordset
    }, 'Gate pass retrieved successfully');
  })
);

/**
 * DELETE /api/v1/gate-passes/:id
 * Delete gate pass
 */
router.delete('/:id',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    // Check if exists
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT id FROM GATE_PASSES WHERE id = @id');

    if (result.recordset.length === 0) {
      return sendError(res, 'Gate pass not found', 404);
    }

    // Delete (cascade will handle assets)
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('DELETE FROM GATE_PASSES WHERE id = @id');

    sendSuccess(res, null, 'Gate pass deleted successfully');
  })
);

/**
 * GET /api/v1/gate-passes/:id/pdf
 * Generate and download gate pass PDF
 */
router.get('/:id/pdf',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COORDINATOR, USER_ROLES.IT_HEAD, USER_ROLES.ENGINEER]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const pool = await connectDB();

    // Get gate pass with assets
    const gatePassResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM GATE_PASSES WHERE id = @id');

    if (gatePassResult.recordset.length === 0) {
      return sendError(res, 'Gate pass not found', 404);
    }

    const assetsResult = await pool.request()
      .input('gate_pass_id', sql.UniqueIdentifier, id)
      .query(`
        SELECT * FROM GATE_PASS_ASSETS
        WHERE gate_pass_id = @gate_pass_id
        ORDER BY
          CASE WHEN parent_asset_id IS NULL THEN 0 ELSE 1 END,
          asset_tag
      `);

    const gatePass = {
      ...gatePassResult.recordset[0],
      assets: assetsResult.recordset
    };

    const pdfBuffer = await GatePassPDF.generate(gatePass);

    const filename = `Gate_Pass_${gatePass.gate_pass_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  })
);

module.exports = router;
