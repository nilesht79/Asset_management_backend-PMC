const express = require('express');
const { connectDB, sql } = require('../../config/database');
const { requirePermission, requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { authenticateToken } = require('../../middleware/auth');
const { sendSuccess, sendError } = require('../../utils/response');
const { roles: USER_ROLES, permissions } = require('../../config/auth');

const router = express.Router();

// Apply authentication to all dashboard routes
router.use(authenticateToken);

// GET /dashboard/superadmin - SuperAdmin dashboard data
router.get('/superadmin',
  requireRole([USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    
    try {
      // Get master data statistics
      const masterDataResult = await pool.request().query(`
        SELECT 
          (SELECT COUNT(*) FROM oems WHERE is_active = 1) as active_oems,
          (SELECT COUNT(*) FROM oems) as total_oems,
          (SELECT COUNT(*) FROM oems WHERE is_active = 0) as pending_oems,
          
          (SELECT COUNT(*) FROM categories WHERE is_active = 1) as active_categories,
          (SELECT COUNT(*) FROM categories) as total_categories,
          (SELECT COUNT(*) FROM categories WHERE parent_category_id IS NOT NULL) as hierarchical_categories,
          
          (SELECT COUNT(*) FROM products WHERE is_active = 1) as active_products,
          (SELECT COUNT(*) FROM products) as total_products,
          (SELECT COUNT(*) FROM products WHERE is_active = 0) as draft_products,
          
          (SELECT COUNT(*) FROM locations WHERE is_active = 1) as active_locations,
          (SELECT COUNT(*) FROM locations) as total_locations,
          (SELECT COUNT(*) FROM locations WHERE is_active = 0) as pending_locations,
          
          (SELECT COUNT(*) FROM DEPARTMENT_MASTER WHERE 1=1) as active_departments,
          (SELECT COUNT(*) FROM DEPARTMENT_MASTER) as total_departments,
          
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status = 'active') as active_users,
          (SELECT COUNT(*) FROM USER_MASTER) as total_users,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status != 'active') as inactive_users
      `);

      const stats = masterDataResult.recordset[0];
      
      const dashboardData = {
        oems: { 
          total: stats.total_oems, 
          active: stats.active_oems, 
          pending: stats.pending_oems 
        },
        categories: { 
          total: stats.total_categories, 
          active: stats.active_categories, 
          pending: stats.total_categories - stats.active_categories, // inactive categories
          hierarchical: stats.hierarchical_categories 
        },
        products: { 
          total: stats.total_products, 
          active: stats.active_products, 
          draft: stats.draft_products 
        },
        locations: { 
          total: stats.total_locations, 
          active: stats.active_locations, 
          pending: stats.pending_locations 
        },
        departments: { 
          total: stats.total_departments, 
          active: stats.active_departments, 
          users: stats.active_users 
        },
        users: {
          total: stats.total_users,
          active: stats.active_users,
          inactive: stats.inactive_users
        }
      };

      sendSuccess(res, dashboardData, 'SuperAdmin dashboard data retrieved successfully');
    } catch (error) {
      console.error('Dashboard error:', error);
      sendError(res, 'Failed to load dashboard data', 500);
    }
  })
);

// GET /dashboard/admin - Admin dashboard data  
router.get('/admin',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    
    try {
      // Get master data statistics for admin
      const masterDataResult = await pool.request().query(`
        SELECT 
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status = 'active') as active_users,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status IN ('active', 'pending')) as total_users,
          (SELECT COUNT(*) FROM DEPARTMENT_MASTER WHERE 1=1) as managed_departments,
          (SELECT COUNT(*) FROM locations WHERE is_active = 1) as active_locations,
          (SELECT COUNT(*) FROM locations) as total_locations,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status = 'pending') as pending_user_approvals,
          
          (SELECT COUNT(*) FROM oems WHERE is_active = 1) as active_oems,
          (SELECT COUNT(*) FROM oems) as total_oems,
          (SELECT COUNT(*) FROM categories WHERE is_active = 1) as active_categories,
          (SELECT COUNT(*) FROM categories) as total_categories,
          (SELECT COUNT(*) FROM products WHERE is_active = 1) as active_products,
          (SELECT COUNT(*) FROM products) as total_products
      `);

      // Get department overview
      const departmentResult = await pool.request().query(`
        SELECT 
          d.department_id as id,
          d.department_name as name,
          COUNT(u.user_id) as users,
          0 as assets, -- Placeholder for Phase 1
          0 as tickets, -- Placeholder for Phase 1  
          1 as status
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER u ON d.department_id = u.department_id AND u.user_status = 'active'
        WHERE 1=1
        GROUP BY d.department_id, d.department_name
        ORDER BY d.department_name
      `);

      const stats = masterDataResult.recordset[0];
      
      const dashboardData = {
        masterStats: {
          totalUsers: stats.total_users,
          activeUsers: stats.active_users,
          managedDepartments: stats.managed_departments,
          totalLocations: stats.total_locations,
          activeLocations: stats.active_locations,
          pendingUserApprovals: stats.pending_user_approvals
        },
        masterDataStats: {
          oems: { 
            total: stats.total_oems, 
            active: stats.active_oems, 
            myManaged: Math.floor(stats.active_oems * 0.6) // Mock calculation
          },
          categories: { 
            total: stats.total_categories, 
            active: stats.active_categories, 
            myCreated: Math.floor(stats.active_categories * 0.4) // Mock calculation
          },
          products: { 
            total: stats.total_products, 
            active: stats.active_products, 
            myManaged: Math.floor(stats.active_products * 0.5) // Mock calculation
          },
          locations: { 
            total: stats.total_locations, 
            active: stats.active_locations, 
            myAssigned: Math.floor(stats.active_locations * 0.7) // Mock calculation
          }
        },
        departmentOverview: departmentResult.recordset.map(dept => ({
          id: dept.id,
          name: dept.name,
          users: dept.users,
          assets: dept.assets,
          tickets: dept.tickets,
          status: dept.status ? 'active' : 'inactive'
        }))
      };

      sendSuccess(res, dashboardData, 'Admin dashboard data retrieved successfully');
    } catch (error) {
      console.error('Dashboard error:', error);
      sendError(res, 'Failed to load dashboard data', 500);
    }
  })
);

// GET /dashboard/system-health - System health metrics
router.get('/system-health',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    try {
      const pool = await connectDB();
      
      // Test database connection and get some basic stats
      const healthResult = await pool.request().query(`
        SELECT 
          @@SERVERNAME as server_name,
          @@VERSION as server_version,
          GETUTCDATE() as current_server_time,
          (SELECT COUNT(*) FROM sys.databases) as database_count
      `);

      const healthData = {
        serverStatus: 'healthy',
        databaseStatus: 'healthy',
        backupStatus: 'completed', // This would be from actual backup logs
        lastBackup: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        dataIntegrity: 99.8,
        serverInfo: {
          name: healthResult.recordset[0].server_name,
          version: healthResult.recordset[0].server_version,
          currentTime: healthResult.recordset[0].current_server_time,
          databaseCount: healthResult.recordset[0].database_count
        }
      };

      sendSuccess(res, healthData, 'System health retrieved successfully');
    } catch (error) {
      console.error('System health error:', error);
      const errorData = {
        serverStatus: 'error',
        databaseStatus: 'error',
        backupStatus: 'unknown',
        lastBackup: null,
        dataIntegrity: 0,
        error: error.message
      };
      
      sendSuccess(res, errorData, 'System health retrieved with errors');
    }
  })
);

// GET /dashboard/activities - Recent system activities
router.get('/activities',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;
    
    const pool = await connectDB();
    
    try {
      // Get recent user activities (working version)
      const activitiesResult = await pool.request()
        .input('limit', sql.Int, Math.min(parseInt(limit), 50))
        .query(`
          SELECT TOP(@limit)
            'user_created' as type,
            CONCAT('User "', u.first_name, ' ', u.last_name, '" (', u.role, ') registered') as description,
            CONCAT('Email: ', u.email, ' • Department: ', ISNULL(d.department_name, 'N/A')) as details,
            CASE 
              WHEN DATEDIFF(MINUTE, u.created_at, GETUTCDATE()) < 60 
              THEN CONCAT(DATEDIFF(MINUTE, u.created_at, GETUTCDATE()), ' minutes ago')
              WHEN DATEDIFF(HOUR, u.created_at, GETUTCDATE()) < 24 
              THEN CONCAT(DATEDIFF(HOUR, u.created_at, GETUTCDATE()), ' hours ago')
              ELSE CONCAT(DATEDIFF(DAY, u.created_at, GETUTCDATE()), ' days ago')
            END as time,
            CASE 
              WHEN u.is_active = 1 THEN 'success'
              ELSE 'warning'
            END as severity,
            u.created_at
          FROM USER_MASTER u
          LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
          WHERE u.created_at >= DATEADD(DAY, -30, GETUTCDATE())
            AND u.user_status != 'deleted'
          ORDER BY u.created_at DESC
        `);

      const activities = activitiesResult.recordset.map((activity, index) => ({
        id: index + 1,
        type: activity.type,
        description: activity.description,
        details: activity.details,
        time: activity.time,
        severity: activity.severity
      }));

      sendSuccess(res, activities, 'Activities retrieved successfully');
    } catch (error) {
      console.error('Activities error:', error);
      sendError(res, 'Failed to load activities', 500);
    }
  })
);

// GET /dashboard/approvals - Pending approvals  
router.get('/approvals',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;
    
    const pool = await connectDB();
    
    try {
      // Get pending user registrations (inactive users)
      const approvalsResult = await pool.request()
        .input('limit', sql.Int, Math.min(parseInt(limit), 50))
        .query(`
          SELECT TOP(@limit)
            u.user_id as id,
            'User Registration' as type,
            CONCAT(u.first_name, ' ', u.last_name, ' - ', u.role) as item,
            CASE 
              WHEN DATEDIFF(HOUR, u.created_at, GETUTCDATE()) < 24 THEN 'high'
              WHEN DATEDIFF(HOUR, u.created_at, GETUTCDATE()) < 72 THEN 'medium'
              ELSE 'low'
            END as priority,
            FORMAT(u.created_at, 'yyyy-MM-dd') as date,
            u.created_at
          FROM USER_MASTER u
          WHERE u.user_status = 'pending'
          ORDER BY u.created_at DESC
        `);

      const approvals = approvalsResult.recordset.map(approval => ({
        id: approval.id,
        type: approval.type,
        item: approval.item,
        priority: approval.priority,
        date: approval.date
      }));

      sendSuccess(res, approvals, 'Pending approvals retrieved successfully');
    } catch (error) {
      console.error('Approvals error:', error);
      sendError(res, 'Failed to load approvals', 500);
    }
  })
);

// POST /dashboard/approvals/:id/approve - Approve a pending item
router.post('/approvals/:id/approve',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { type } = req.body;
    
    const pool = await connectDB();
    
    try {
      if (type === 'User Registration') {
        // Approve user registration by activating the user
        const result = await pool.request()
          .input('userId', sql.UniqueIdentifier, id)
          .query(`
            UPDATE USER_MASTER
            SET is_active = 1, user_status = 'active', updated_at = GETUTCDATE()
            WHERE user_id = @userId AND user_status = 'pending'
          `);

        if (result.rowsAffected[0] === 0) {
          return sendError(res, 'User not found or already approved', 404);
        }
      }
      
      sendSuccess(res, null, `${type} approved successfully`);
    } catch (error) {
      console.error('Approval error:', error);
      sendError(res, 'Failed to approve item', 500);
    }
  })
);

// POST /dashboard/approvals/:id/reject - Reject a pending item
router.post('/approvals/:id/reject',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { type, reason = '' } = req.body;

    const pool = await connectDB();

    try {
      if (type === 'User Registration') {
        // Reject user registration by deleting the pending user
        const result = await pool.request()
          .input('userId', sql.UniqueIdentifier, id)
          .query(`
            DELETE FROM USER_MASTER
            WHERE user_id = @userId AND user_status = 'pending'
          `);

        if (result.rowsAffected[0] === 0) {
          return sendError(res, 'User not found or already processed', 404);
        }
      }

      sendSuccess(res, null, `${type} rejected successfully`);
    } catch (error) {
      console.error('Rejection error:', error);
      sendError(res, 'Failed to reject item', 500);
    }
  })
);

// GET /dashboard/coordinator - Coordinator dashboard data (ITSM-level KPIs)
router.get('/coordinator',
  requireRole([USER_ROLES.COORDINATOR, USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    try {
      // 1. Asset Management KPIs
      const assetStatsResult = await pool.request().query(`
        SELECT
          -- Overall Asset Stats
          (SELECT COUNT(*) FROM assets WHERE is_active = 1) as total_assets,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND status = 'assigned') as assigned_assets,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND status = 'available') as available_assets,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND status = 'under_repair') as under_repair_assets,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND status = 'retired') as retired_assets,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND warranty_end_date BETWEEN GETUTCDATE() AND DATEADD(DAY, 30, GETUTCDATE())) as warranty_expiring_soon,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND created_at >= DATETRUNC(MONTH, GETUTCDATE())) as added_this_month,

          -- Asset by Condition
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND condition_status = 'good') as condition_good,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND condition_status = 'fair') as condition_fair,
          (SELECT COUNT(*) FROM assets WHERE is_active = 1 AND condition_status = 'poor') as condition_poor
      `);

      // 2. Ticket Management KPIs
      const ticketStatsResult = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM TICKETS) as total_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE status = 'open') as open_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE status = 'assigned') as assigned_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE status = 'in_progress') as in_progress_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE status = 'pending') as pending_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE status IN ('resolved', 'closed')) as resolved_tickets,

          -- Today's Tickets
          (SELECT COUNT(*) FROM TICKETS WHERE CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)) as today_created,
          (SELECT COUNT(*) FROM TICKETS WHERE CAST(resolved_at AS DATE) = CAST(GETUTCDATE() AS DATE)) as today_resolved,

          -- This Week
          (SELECT COUNT(*) FROM TICKETS WHERE created_at >= DATETRUNC(WEEK, GETUTCDATE())) as week_created,
          (SELECT COUNT(*) FROM TICKETS WHERE resolved_at >= DATETRUNC(WEEK, GETUTCDATE())) as week_resolved,

          -- Unassigned Tickets
          (SELECT COUNT(*) FROM TICKETS WHERE status = 'open' AND assigned_to_engineer_id IS NULL) as unassigned_tickets,

          -- Tickets by Priority (Active)
          (SELECT COUNT(*) FROM TICKETS WHERE priority = 'critical' AND status NOT IN ('resolved', 'closed', 'cancelled')) as critical_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE priority = 'high' AND status NOT IN ('resolved', 'closed', 'cancelled')) as high_priority_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE priority = 'medium' AND status NOT IN ('resolved', 'closed', 'cancelled')) as medium_priority_tickets,
          (SELECT COUNT(*) FROM TICKETS WHERE priority = 'low' AND status NOT IN ('resolved', 'closed', 'cancelled')) as low_priority_tickets
      `);

      // 3. SLA KPIs
      const slaStatsResult = await pool.request().query(`
        SELECT
          -- SLA Compliance (Last 30 days)
          COUNT(
            CASE
              WHEN sla.final_status IN ('on_track', 'warning', 'critical')
              THEN 1
            END
          ) as within_sla_count,

          COUNT(
            CASE
              WHEN sla.final_status = 'breached'
              THEN 1
            END
          ) as breached_count,

          COUNT(*) as total_resolved_with_sla,

          CASE
            WHEN COUNT(*) > 0 THEN
              CAST(
                COUNT(
                  CASE
                    WHEN sla.final_status IN ('on_track', 'warning', 'critical')
                    THEN 1
                  END
                ) AS FLOAT
              ) / COUNT(*) * 100
            ELSE 0
          END as sla_compliance_rate,



          -- Active SLA Status
          (SELECT COUNT(*) FROM TICKET_SLA_TRACKING sla JOIN TICKETS t ON sla.ticket_id = t.ticket_id WHERE sla.sla_status = 'on_track' AND t.status NOT IN ('resolved', 'closed', 'cancelled')) as active_on_track,
          (SELECT COUNT(*) FROM TICKET_SLA_TRACKING sla JOIN TICKETS t ON sla.ticket_id = t.ticket_id WHERE sla.sla_status = 'warning' AND t.status NOT IN ('resolved', 'closed', 'cancelled')) as active_warning,
          (SELECT COUNT(*) FROM TICKET_SLA_TRACKING sla JOIN TICKETS t ON sla.ticket_id = t.ticket_id WHERE sla.sla_status = 'critical' AND t.status NOT IN ('resolved', 'closed', 'cancelled')) as active_critical,
          (SELECT COUNT(*) FROM TICKET_SLA_TRACKING sla JOIN TICKETS t ON sla.ticket_id = t.ticket_id WHERE sla.breach_triggered_at IS NOT NULL AND t.status NOT IN ('resolved', 'closed', 'cancelled')) as active_breached
        FROM TICKETS t
        JOIN TICKET_SLA_TRACKING sla ON t.ticket_id = sla.ticket_id
        WHERE t.status IN ('resolved', 'closed')
        AND t.resolved_at >= DATEADD(DAY, -30, GETUTCDATE())
      `);

      // 4. Requisition KPIs
      const requisitionStatsResult = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS) as total_requisitions,
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE status IN ('pending_dept_head', 'pending_it_head')) as pending_approval,
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE status = 'pending_assignment') as pending_assignment,
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE status = 'assigned') as assigned_pending_delivery,
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE status = 'delivered') as delivered,
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE status = 'completed') as completed,
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE status LIKE 'rejected%') as rejected,

          -- This Month
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE created_at >= DATETRUNC(MONTH, GETUTCDATE())) as month_total,
          (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE status = 'completed' AND updated_at >= DATETRUNC(MONTH, GETUTCDATE())) as month_completed
      `);

      // 5. Consumable KPIs
      const consumableStatsResult = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM consumable_requests) as total_requests,
          (SELECT COUNT(*) FROM consumable_requests WHERE status = 'pending') as pending_requests,
          (SELECT COUNT(*) FROM consumable_requests WHERE status = 'approved') as approved_requests,
          (SELECT COUNT(*) FROM consumable_requests WHERE status = 'delivered') as delivered_requests,
          (SELECT COUNT(*) FROM consumable_requests WHERE status = 'rejected') as rejected_requests,

          -- This Month
          (SELECT COUNT(*) FROM consumable_requests WHERE created_at >= DATETRUNC(MONTH, GETUTCDATE())) as month_total,
          (SELECT COUNT(*) FROM consumable_requests WHERE status = 'delivered' AND delivered_at >= DATETRUNC(MONTH, GETUTCDATE())) as month_delivered,

          -- Inventory Alerts (join consumables with consumable_inventory to get stock levels)
          (SELECT COUNT(DISTINCT c.id) FROM consumables c
           LEFT JOIN consumable_inventory ci ON c.id = ci.consumable_id
           WHERE c.is_active = 1 AND ISNULL(ci.quantity_in_stock, 0) <= c.reorder_level AND ISNULL(ci.quantity_in_stock, 0) > 0) as low_stock_items,
          (SELECT COUNT(DISTINCT c.id) FROM consumables c
           LEFT JOIN consumable_inventory ci ON c.id = ci.consumable_id
           WHERE c.is_active = 1 AND ISNULL(ci.quantity_in_stock, 0) = 0) as out_of_stock_items
      `);

      // 6. Delivery Management KPIs
      const deliveryStatsResult = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM ASSET_DELIVERY_TICKETS WHERE status = 'pending') as pending_deliveries,
          (SELECT COUNT(*) FROM ASSET_DELIVERY_TICKETS WHERE status = 'scheduled') as scheduled_deliveries,
          (SELECT COUNT(*) FROM ASSET_DELIVERY_TICKETS WHERE status = 'in_transit') as in_transit_deliveries,
          (SELECT COUNT(*) FROM ASSET_DELIVERY_TICKETS WHERE status = 'delivered') as completed_deliveries,

          -- Today's Deliveries
          (SELECT COUNT(*) FROM ASSET_DELIVERY_TICKETS WHERE CAST(scheduled_delivery_date AS DATE) = CAST(GETUTCDATE() AS DATE)) as today_scheduled,
          (SELECT COUNT(*) FROM ASSET_DELIVERY_TICKETS WHERE CAST(actual_delivery_date AS DATE) = CAST(GETUTCDATE() AS DATE) AND status = 'delivered') as today_completed
      `);

      // 7. Ticket Distribution by Category
      const ticketCategoryResult = await pool.request().query(`
        SELECT TOP 10
          category,
          COUNT(*) as total_tickets,

          -- Individual status counts
          COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tickets,
          COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned_tickets,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tickets,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_tickets,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_tickets,
          COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_tickets,

          -- Today's counts
          COUNT(CASE WHEN CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 END) as today_total,
          COUNT(CASE WHEN status = 'open' AND CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 END) as today_open,
          COUNT(CASE WHEN status = 'assigned' AND CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 END) as today_assigned,
          COUNT(CASE WHEN status = 'in_progress' AND CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 END) as today_in_progress,
          COUNT(CASE WHEN status = 'resolved' AND CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 END) as today_resolved,
          COUNT(CASE WHEN status = 'closed' AND CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 END) as today_closed
        FROM TICKETS
        WHERE category IS NOT NULL
        GROUP BY category
        ORDER BY total_tickets DESC
      `);

      // 8. Asset Distribution by Location (through assigned user's location)
      const locationDistResult = await pool.request().query(`
        SELECT TOP 10
          l.name as location_name,
          COUNT(a.id) as asset_count
        FROM locations l
        LEFT JOIN USER_MASTER u ON l.id = u.location_id AND u.is_active = 1
        LEFT JOIN assets a ON u.user_id = a.assigned_to AND a.is_active = 1 AND a.status = 'assigned'
        WHERE l.is_active = 1
        GROUP BY l.id, l.name
        ORDER BY asset_count DESC
      `);

      // 9. Recent Pending Actions (Top 10)
      const pendingActionsResult = await pool.request().query(`
        SELECT TOP 10
          'requisition' as type,
          CAST(r.requisition_id AS VARCHAR(50)) as id,
          r.requisition_number as reference,
          CONCAT('Asset requisition from ', u.first_name, ' ', u.last_name) as description,
          r.status,
          r.urgency as priority,
          r.created_at
        FROM ASSET_REQUISITIONS r
        JOIN USER_MASTER u ON r.requested_by = u.user_id
        WHERE r.status = 'pending_assignment'

        UNION ALL

        SELECT TOP 10
          'ticket' as type,
          CAST(t.ticket_id AS VARCHAR(50)) as id,
          t.ticket_number as reference,
          t.title as description,
          t.status,
          t.priority,
          t.created_at
        FROM TICKETS t
        WHERE t.status = 'open' AND t.assigned_to_engineer_id IS NULL

        UNION ALL

        SELECT TOP 10
          'delivery' as type,
          CAST(d.ticket_id AS VARCHAR(50)) as id,
          d.ticket_number as reference,
          CONCAT('Delivery for ', d.user_name, ' - ', d.asset_tag) as description,
          d.status,
          'normal' as priority,
          d.created_at
        FROM ASSET_DELIVERY_TICKETS d
        WHERE d.status = 'pending'

        ORDER BY created_at DESC
      `);

      // 10. Engineer Workload Summary (using subqueries to avoid Cartesian product)
      const engineerWorkloadResult = await pool.request().query(`
        SELECT TOP 10
          u.user_id as engineer_id,
          u.first_name + ' ' + u.last_name as engineer_name,
          ISNULL((SELECT COUNT(*) FROM TICKETS t WHERE t.assigned_to_engineer_id = u.user_id AND t.status IN ('assigned', 'in_progress')), 0) as active_tickets,
          ISNULL((SELECT COUNT(*) FROM ASSET_DELIVERY_TICKETS d WHERE d.delivered_by = u.user_id AND d.status IN ('pending', 'scheduled', 'in_transit')), 0) as pending_deliveries,
          ISNULL((SELECT COUNT(*) FROM TICKETS t WHERE t.assigned_to_engineer_id = u.user_id AND t.status IN ('resolved', 'closed') AND t.resolved_at >= DATETRUNC(WEEK, GETUTCDATE())), 0) as resolved_this_week
        FROM USER_MASTER u
        WHERE u.role = 'engineer' AND u.is_active = 1
        ORDER BY active_tickets DESC
      `);

      // Build response
      const assetStats = assetStatsResult.recordset[0];
      const ticketStats = ticketStatsResult.recordset[0];
      const slaStats = slaStatsResult.recordset[0];
      const requisitionStats = requisitionStatsResult.recordset[0];
      const consumableStats = consumableStatsResult.recordset[0];
      const deliveryStats = deliveryStatsResult.recordset[0];

      const dashboardData = {
        // Asset KPIs
        assets: {
          total: assetStats.total_assets || 0,
          assigned: assetStats.assigned_assets || 0,
          available: assetStats.available_assets || 0,
          underRepair: assetStats.under_repair_assets || 0,
          retired: assetStats.retired_assets || 0,
          warrantyExpiring: assetStats.warranty_expiring_soon || 0,
          addedThisMonth: assetStats.added_this_month || 0,
          utilizationRate: assetStats.total_assets > 0
            ? ((assetStats.assigned_assets / assetStats.total_assets) * 100).toFixed(1)
            : 0,
          condition: {
            good: assetStats.condition_good || 0,
            fair: assetStats.condition_fair || 0,
            poor: assetStats.condition_poor || 0
          }
        },

        // Ticket KPIs
        tickets: {
          total: ticketStats.total_tickets || 0,
          open: ticketStats.open_tickets || 0,
          assigned: ticketStats.assigned_tickets || 0,
          inProgress: ticketStats.in_progress_tickets || 0,
          pending: ticketStats.pending_tickets || 0,
          resolved: ticketStats.resolved_tickets || 0,
          unassigned: ticketStats.unassigned_tickets || 0,
          today: {
            created: ticketStats.today_created || 0,
            resolved: ticketStats.today_resolved || 0
          },
          thisWeek: {
            created: ticketStats.week_created || 0,
            resolved: ticketStats.week_resolved || 0
          },
          byPriority: {
            critical: ticketStats.critical_tickets || 0,
            high: ticketStats.high_priority_tickets || 0,
            medium: ticketStats.medium_priority_tickets || 0,
            low: ticketStats.low_priority_tickets || 0
          },
          byCategory: ticketCategoryResult.recordset
        },

        // SLA KPIs
        sla: {
          complianceRate: parseFloat(slaStats.sla_compliance_rate || 0).toFixed(1),
          withinSla: slaStats.within_sla_count || 0,
          breached: slaStats.breached_count || 0,
          totalResolved: slaStats.total_resolved_with_sla || 0,
          activeStatus: {
            onTrack: slaStats.active_on_track || 0,
            warning: slaStats.active_warning || 0,
            critical: slaStats.active_critical || 0,
            breached: slaStats.active_breached || 0
          },
          atRisk: (slaStats.active_warning || 0) + (slaStats.active_critical || 0) + (slaStats.active_breached || 0)
        },

        // Requisition KPIs
        requisitions: {
          total: requisitionStats.total_requisitions || 0,
          pendingApproval: requisitionStats.pending_approval || 0,
          pendingAssignment: requisitionStats.pending_assignment || 0,
          assignedPendingDelivery: requisitionStats.assigned_pending_delivery || 0,
          delivered: requisitionStats.delivered || 0,
          completed: requisitionStats.completed || 0,
          rejected: requisitionStats.rejected || 0,
          thisMonth: {
            total: requisitionStats.month_total || 0,
            completed: requisitionStats.month_completed || 0
          }
        },

        // Consumable KPIs
        consumables: {
          totalRequests: consumableStats.total_requests || 0,
          pending: consumableStats.pending_requests || 0,
          approved: consumableStats.approved_requests || 0,
          delivered: consumableStats.delivered_requests || 0,
          rejected: consumableStats.rejected_requests || 0,
          thisMonth: {
            total: consumableStats.month_total || 0,
            delivered: consumableStats.month_delivered || 0
          },
          inventory: {
            lowStock: consumableStats.low_stock_items || 0,
            outOfStock: consumableStats.out_of_stock_items || 0
          }
        },

        // Delivery KPIs
        deliveries: {
          pending: deliveryStats.pending_deliveries || 0,
          scheduled: deliveryStats.scheduled_deliveries || 0,
          inTransit: deliveryStats.in_transit_deliveries || 0,
          completed: deliveryStats.completed_deliveries || 0,
          today: {
            scheduled: deliveryStats.today_scheduled || 0,
            completed: deliveryStats.today_completed || 0
          }
        },

        // Distribution Data
        locationDistribution: locationDistResult.recordset,
        engineerWorkload: engineerWorkloadResult.recordset,
        pendingActions: pendingActionsResult.recordset
      };

      sendSuccess(res, dashboardData, 'Coordinator dashboard data retrieved successfully');
    } catch (error) {
      console.error('Coordinator dashboard error:', error);
      sendError(res, 'Failed to load coordinator dashboard data', 500);
    }
  })
);

// GET /dashboard/employee - Employee dashboard data
router.get('/employee',
  requireRole([USER_ROLES.EMPLOYEE, USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  requirePermission(permissions.ASSET_READ),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const userId = req.user.id;

    try {
      // 1. Get KPI Statistics
      const statsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT
            -- My Assets (exclude retired)
            (SELECT COUNT(*) FROM assets WHERE assigned_to = @userId AND is_active = 1 AND status <> 'retired') as total_assets,

            -- My Requisitions
            (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE requested_by = @userId) as total_requisitions,
            (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE requested_by = @userId
              AND status IN ('pending_dept_head', 'pending_it_head', 'pending_assignment')) as pending_requisitions,
            (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE requested_by = @userId
              AND status IN ('approved_by_dept_head', 'approved_by_it_head', 'assigned')) as approved_requisitions,
            (SELECT COUNT(*) FROM ASSET_REQUISITIONS WHERE requested_by = @userId
              AND status = 'completed') as completed_requisitions,

            -- My Tickets
            (SELECT COUNT(*) FROM TICKETS WHERE created_by_user_id = @userId) as total_tickets,
            (SELECT COUNT(*) FROM TICKETS WHERE created_by_user_id = @userId
              AND status IN ('open', 'assigned', 'in_progress')) as open_tickets,
            (SELECT COUNT(*) FROM TICKETS WHERE created_by_user_id = @userId
              AND status IN ('resolved', 'closed')) as resolved_tickets,

            -- My Consumable Requests
            (SELECT COUNT(*) FROM consumable_requests WHERE requested_by = @userId) as total_consumable_requests,
            (SELECT COUNT(*) FROM consumable_requests WHERE requested_by = @userId
              AND status = 'pending') as pending_consumable_requests,
            (SELECT COUNT(*) FROM consumable_requests WHERE requested_by = @userId
              AND status = 'delivered') as delivered_consumable_requests
        `);

      // 2. Get Recent Assets (Top 5)
      const assetsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT TOP 5
            a.id,
            a.asset_tag,
            a.serial_number,
            p.name as product_name,
            c.name as category_name,
            a.status,
            a.condition_status,
            a.created_at as assigned_at
          FROM assets a
          LEFT JOIN products p ON a.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE a.assigned_to = @userId AND a.is_active = 1 AND a.status <> 'retired'
          ORDER BY a.created_at DESC
        `);

      // 3. Get Recent Requisitions (Top 5)
      const requisitionsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT TOP 5
            requisition_id,
            requisition_number,
            purpose,
            status,
            urgency,
            created_at,
            required_by_date
          FROM ASSET_REQUISITIONS
          WHERE requested_by = @userId
          ORDER BY created_at DESC
        `);

      // 4. Get Recent Tickets (Top 5)
      const ticketsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT TOP 5
            t.ticket_id,
            t.ticket_number,
            t.title,
            t.status,
            t.priority,
            t.category,
            t.created_at,
            t.resolved_at,
            u.first_name + ' ' + u.last_name as engineer_name
          FROM TICKETS t
          LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
          WHERE t.created_by_user_id = @userId
          ORDER BY t.created_at DESC
        `);

      // 5. Get Recent Consumable Requests (Top 5)
      const consumableRequestsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT TOP 5
            cr.id,
            cr.request_number,
            c.name as consumable_name,
            cr.quantity_requested,
            cr.quantity_issued,
            cr.status,
            cr.priority,
            cr.created_at,
            cr.delivered_at
          FROM consumable_requests cr
          JOIN consumables c ON cr.consumable_id = c.id
          WHERE cr.requested_by = @userId
          ORDER BY cr.created_at DESC
        `);

      const stats = statsResult.recordset[0];

      const dashboardData = {
        stats: {
          totalAssets: stats.total_assets || 0,
          totalRequisitions: stats.total_requisitions || 0,
          pendingRequisitions: stats.pending_requisitions || 0,
          approvedRequisitions: stats.approved_requisitions || 0,
          completedRequisitions: stats.completed_requisitions || 0,
          totalTickets: stats.total_tickets || 0,
          openTickets: stats.open_tickets || 0,
          resolvedTickets: stats.resolved_tickets || 0,
          totalConsumableRequests: stats.total_consumable_requests || 0,
          pendingConsumableRequests: stats.pending_consumable_requests || 0,
          deliveredConsumableRequests: stats.delivered_consumable_requests || 0
        },
        myAssets: assetsResult.recordset,
        myRequisitions: requisitionsResult.recordset,
        myTickets: ticketsResult.recordset,
        myConsumableRequests: consumableRequestsResult.recordset
      };

      sendSuccess(res, dashboardData, 'Employee dashboard data retrieved successfully');
    } catch (error) {
      console.error('Employee dashboard error:', error);
      sendError(res, 'Failed to load employee dashboard data', 500);
    }
  })
);

// GET /dashboard/engineer - Engineer dashboard data
router.get('/engineer',
  requireRole([USER_ROLES.ENGINEER, USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const engineerId = req.user.id;

    try {
      // 1. Get KPI Statistics
      const kpiResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT
            -- Active Tickets
            (
              SELECT COUNT(*)
              FROM TICKETS
              WHERE assigned_to_engineer_id = @engineerId
              AND status IN ('open', 'assigned', 'in_progress', 'pending')
            ) as active_tickets,

            -- Pending Deliveries (including in_transit from requisition assignments)
            (
              SELECT COUNT(*)
              FROM ASSET_DELIVERY_TICKETS
              WHERE delivered_by = @engineerId
              AND status IN ('pending', 'scheduled', 'in_transit')
            ) as pending_deliveries,

            -- SLA At Risk (tickets in warning or critical zones)
            (
              SELECT COUNT(*)
              FROM TICKET_SLA_TRACKING sla
              JOIN TICKETS t ON sla.ticket_id = t.ticket_id
              WHERE t.assigned_to_engineer_id = @engineerId
              AND sla.sla_status IN ('warning', 'critical')
              AND t.status NOT IN ('resolved', 'closed')
            ) as sla_at_risk,

            -- Today's Completed
            (
              SELECT COUNT(*)
              FROM TICKETS
              WHERE assigned_to_engineer_id = @engineerId
              AND CAST(resolved_at AS DATE) = CAST(GETUTCDATE() AS DATE)
            ) as today_completed,

            -- Overdue Tickets (breached SLA - exceeded max TAT)
            (
              SELECT COUNT(*)
              FROM TICKETS t
              JOIN TICKET_SLA_TRACKING sla ON t.ticket_id = sla.ticket_id
              WHERE t.assigned_to_engineer_id = @engineerId
              AND t.status NOT IN ('resolved', 'closed')
              AND sla.breach_triggered_at IS NOT NULL
            ) as overdue_tickets,

            -- Pending Consumable Deliveries (assigned to engineer)
            (
              SELECT COUNT(*)
              FROM consumable_requests
              WHERE assigned_engineer = @engineerId
              AND status = 'approved'
            ) as pending_consumable_deliveries
        `);

      // 2. Get Active Tickets (Top 10 most urgent)
      const activeTicketsResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT TOP 10
            t.ticket_id,
            t.ticket_number,
            t.title,
            t.priority,
            t.status,
            t.category,
            t.created_at,
            t.due_date,
            sla.sla_status,
            sla.business_elapsed_minutes,
            sla.max_target_time,
            sla.warning_triggered_at,
            sla.breach_triggered_at,
            CASE
              WHEN sla.breach_triggered_at IS NOT NULL THEN
                DATEDIFF(MINUTE, sla.breach_triggered_at, GETUTCDATE())
              WHEN sla.warning_triggered_at IS NOT NULL THEN
                DATEDIFF(MINUTE, GETUTCDATE(), sla.max_target_time)
              ELSE NULL
            END as time_remaining_minutes
          FROM TICKETS t
          LEFT JOIN TICKET_SLA_TRACKING sla ON t.ticket_id = sla.ticket_id
          WHERE t.assigned_to_engineer_id = @engineerId
          AND t.status IN ('open', 'assigned', 'in_progress', 'pending')
          ORDER BY
            CASE t.priority
              WHEN 'critical' THEN 1
              WHEN 'emergency' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END,
            CASE
              WHEN sla.breach_triggered_at IS NOT NULL THEN 1
              WHEN sla.sla_status = 'critical' THEN 2
              WHEN sla.sla_status = 'warning' THEN 3
              ELSE 4
            END,
            t.due_date ASC
        `);

      // 3. Get Pending Deliveries (Top 10) - including in_transit from requisition assignments
      const deliveriesResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT TOP 10
            ticket_id,
            ticket_number,
            asset_tag,
            user_name,
            delivery_location_name,
            scheduled_delivery_date,
            status
          FROM ASSET_DELIVERY_TICKETS
          WHERE delivered_by = @engineerId
          AND status IN ('pending', 'scheduled', 'in_transit')
          ORDER BY scheduled_delivery_date ASC
        `);

      // 4. Get Pending Consumable Deliveries (Top 10)
      const consumableDeliveriesResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT TOP 10
            cr.id,
            cr.request_number,
            c.name as consumable_name,
            cr.quantity_requested,
            u.first_name + ' ' + u.last_name as requested_for_name,
            loc.name as location_name,
            cr.priority,
            cr.approved_at,
            cr.created_at
          FROM consumable_requests cr
          JOIN consumables c ON cr.consumable_id = c.id
          JOIN USER_MASTER u ON cr.requested_by = u.user_id
          LEFT JOIN locations loc ON u.location_id = loc.id
          WHERE cr.assigned_engineer = @engineerId
          AND cr.status = 'approved'
          ORDER BY
            CASE cr.priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'normal' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END,
            cr.approved_at ASC
        `);

      // 5. Get Ticket Resolution Trend (Last 7 days)
      const resolutionTrendResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT
            CAST(resolved_at AS DATE) as date,
            COUNT(*) as resolved_count
          FROM TICKETS
          WHERE assigned_to_engineer_id = @engineerId
          AND resolved_at >= DATEADD(DAY, -7, GETUTCDATE())
          GROUP BY CAST(resolved_at AS DATE)
          ORDER BY date
        `);

      // 5. Get Tickets by Priority Distribution
      const priorityDistributionResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT
            priority,
            COUNT(*) as count
          FROM TICKETS
          WHERE assigned_to_engineer_id = @engineerId
          AND status NOT IN ('closed', 'cancelled')
          GROUP BY priority
        `);

      // 6. Get SLA Compliance Rate
      const slaComplianceResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT
            COUNT(CASE WHEN sla.final_status = 'on_track' THEN 1 END) as within_sla_count,
            COUNT(*) as total_resolved,
            CASE
              WHEN COUNT(*) > 0 THEN
                CAST(COUNT(CASE WHEN sla.final_status = 'on_track' THEN 1 END) AS FLOAT) / COUNT(*) * 100
              ELSE 0
            END as compliance_percentage
          FROM TICKETS t
          JOIN TICKET_SLA_TRACKING sla ON t.ticket_id = sla.ticket_id
          WHERE t.assigned_to_engineer_id = @engineerId
          AND t.status IN ('resolved', 'closed')
          AND t.resolved_at >= DATEADD(DAY, -30, GETUTCDATE())
        `);

      // 8. Get Average Resolution Time
      const avgResolutionResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT
            AVG(sla.business_elapsed_minutes) as avg_resolution_minutes,
            AVG(DATEDIFF(MINUTE, sla.sla_start_time, sla.max_target_time)) as avg_sla_target_minutes
          FROM TICKETS t
          JOIN TICKET_SLA_TRACKING sla ON t.ticket_id = sla.ticket_id
          WHERE t.assigned_to_engineer_id = @engineerId
          AND t.status IN ('resolved', 'closed')
          AND t.resolved_at >= DATEADD(DAY, -30, GETUTCDATE())
          AND sla.sla_start_time IS NOT NULL
          AND sla.max_target_time IS NOT NULL
        `);

      // 7. Get Recent Service Reports (Top 5)
      const serviceReportsResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT TOP 5
            sr.report_id,
            sr.report_number,
            sr.ticket_id,
            sr.service_type,
            sr.asset_id,
            sr.created_at,
            sr.status,
            t.ticket_number,
            a.asset_tag
          FROM SERVICE_REPORTS sr
          LEFT JOIN TICKETS t ON sr.ticket_id = t.ticket_id
          LEFT JOIN assets a ON sr.asset_id = a.id
          WHERE sr.created_by = @engineerId
          ORDER BY sr.created_at DESC
        `);

      // 8. Get Work Summary (This Week and This Month - calendar based)
      const workSummaryResult = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT
            -- This Week (current calendar week starting Sunday)
            (
              SELECT COUNT(*)
              FROM TICKETS
              WHERE assigned_to_engineer_id = @engineerId
              AND status IN ('resolved', 'closed')
              AND resolved_at >= DATETRUNC(WEEK, GETUTCDATE())
            ) as week_tickets_resolved,

            (
              SELECT COUNT(*)
              FROM ASSET_DELIVERY_TICKETS
              WHERE delivered_by = @engineerId
              AND status = 'delivered'
              AND actual_delivery_date >= DATETRUNC(WEEK, GETUTCDATE())
            ) as week_asset_deliveries_completed,

            (
              SELECT COUNT(*)
              FROM consumable_requests
              WHERE assigned_engineer = @engineerId
              AND status = 'delivered'
              AND delivered_at >= DATETRUNC(WEEK, GETUTCDATE())
            ) as week_consumable_deliveries_completed,

            (
              SELECT COUNT(*)
              FROM RECONCILIATION_RECORDS
              WHERE reconciled_by = @engineerId
              AND reconciliation_status IN ('verified', 'discrepancy', 'damaged')
              AND reconciled_at >= DATETRUNC(WEEK, GETUTCDATE())
            ) as week_assets_reconciled,

            -- This Month (current calendar month)
            (
              SELECT COUNT(*)
              FROM TICKETS
              WHERE assigned_to_engineer_id = @engineerId
              AND status IN ('resolved', 'closed')
              AND resolved_at >= DATETRUNC(MONTH, GETUTCDATE())
            ) as month_tickets_resolved,

            (
              SELECT COUNT(*)
              FROM ASSET_DELIVERY_TICKETS
              WHERE delivered_by = @engineerId
              AND status = 'delivered'
              AND actual_delivery_date >= DATETRUNC(MONTH, GETUTCDATE())
            ) as month_asset_deliveries_completed,

            (
              SELECT COUNT(*)
              FROM consumable_requests
              WHERE assigned_engineer = @engineerId
              AND status = 'delivered'
              AND delivered_at >= DATETRUNC(MONTH, GETUTCDATE())
            ) as month_consumable_deliveries_completed,

            (
              SELECT COUNT(*)
              FROM RECONCILIATION_RECORDS
              WHERE reconciled_by = @engineerId
              AND reconciliation_status IN ('verified', 'discrepancy', 'damaged')
              AND reconciled_at >= DATETRUNC(MONTH, GETUTCDATE())
            ) as month_assets_reconciled
        `);

      // Build dashboard response
      const kpi = kpiResult.recordset[0];
      const slaCompliance = slaComplianceResult.recordset[0];
      const avgResolution = avgResolutionResult.recordset[0];
      const workSummary = workSummaryResult.recordset[0];

      const dashboardData = {
        kpi: {
          activeTickets: kpi.active_tickets,
          pendingDeliveries: kpi.pending_deliveries,
          pendingConsumableDeliveries: kpi.pending_consumable_deliveries,
          slaAtRisk: kpi.sla_at_risk,
          todayCompleted: kpi.today_completed,
          overdueTickets: kpi.overdue_tickets
        },
        activeTickets: activeTicketsResult.recordset,
        pendingDeliveries: deliveriesResult.recordset,
        pendingConsumableDeliveries: consumableDeliveriesResult.recordset,
        performance: {
          resolutionTrend: resolutionTrendResult.recordset,
          priorityDistribution: priorityDistributionResult.recordset,
          slaCompliance: {
            withinSla: slaCompliance?.within_sla_count || 0,
            totalResolved: slaCompliance?.total_resolved || 0,
            compliancePercentage: slaCompliance?.compliance_percentage || 0
          },
          averageResolutionTime: {
            avgMinutes: avgResolution?.avg_resolution_minutes || 0,
            avgSlaTargetMinutes: avgResolution?.avg_sla_target_minutes || 0
          }
        },
        recentServiceReports: serviceReportsResult.recordset,
        workSummary: {
          thisWeek: {
            ticketsResolved: workSummary?.week_tickets_resolved || 0,
            assetDeliveries: workSummary?.week_asset_deliveries_completed || 0,
            consumableDeliveries: workSummary?.week_consumable_deliveries_completed || 0,
            assetsReconciled: workSummary?.week_assets_reconciled || 0
          },
          thisMonth: {
            ticketsResolved: workSummary?.month_tickets_resolved || 0,
            assetDeliveries: workSummary?.month_asset_deliveries_completed || 0,
            consumableDeliveries: workSummary?.month_consumable_deliveries_completed || 0,
            assetsReconciled: workSummary?.month_assets_reconciled || 0
          }
        }
      };

      sendSuccess(res, dashboardData, 'Engineer dashboard data retrieved successfully');
    } catch (error) {
      console.error('Engineer dashboard error:', error);
      sendError(res, 'Failed to load engineer dashboard data', 500);
    }
  })
);

module.exports = router;
