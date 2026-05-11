/**
 * TICKET MODEL
 * Handles all database operations for the ticket management system
 */

const { connectDB, sql } = require('../config/database');
const ServiceReportModel = require('./serviceReport');
const AssetRepairHistoryModel = require('./assetRepairHistory');
const SlaTrackingModel = require('./slaTracking');

class TicketModel {
  /**
   * Generate unique ticket number
   * Format: TKT-YYYY-NNNN (e.g., TKT-2025-0001)
   */
  static async generateTicketNumber() {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .output('TicketNumber', sql.VarChar(20))
        .execute('sp_GenerateTicketNumber');

      return result.output.TicketNumber;
    } catch (error) {
      console.error('Error generating ticket number:', error);
      throw new Error('Failed to generate ticket number');
    }
  }

  /**
   * Create a new ticket
   * Department and Location are inherited from created_by_user_id
   */
  static async createTicket(ticketData) {
    try {
      const pool = await connectDB();

      // Step 1: Get employee's department and location
      const userQuery = `
        SELECT
          user_id,
          first_name,
          last_name,
          email,
          employee_id,
          department_id,
          location_id,
          role
        FROM USER_MASTER
        WHERE user_id = @userId AND is_active = 1
      `;

      const userResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, ticketData.created_by_user_id)
        .query(userQuery);

      if (userResult.recordset.length === 0) {
        throw new Error('User not found or inactive');
      }

      const employee = userResult.recordset[0];

      // Step 2: Generate ticket number
      const ticketNumber = await this.generateTicketNumber();

      // Step 3: Insert ticket with inherited dept/location
      const insertQuery = `
        INSERT INTO TICKETS (
          ticket_id,
          ticket_number,
          title,
          description,
          status,
          priority,
          created_by_user_id,
          created_by_coordinator_id,
          assigned_to_engineer_id,
          department_id,
          location_id,
          category,
          ticket_type,
          service_type,
          due_date,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @ticketNumber,
          @title,
          @description,
          @status,
          @priority,
          @createdByUserId,
          @createdByCoordinatorId,
          @assignedToEngineerId,
          @departmentId,
          @locationId,
          @category,
          @ticketType,
          @serviceType,
          @dueDate,
          GETUTCDATE(),
          GETUTCDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketNumber', sql.VarChar(20), ticketNumber)
        .input('title', sql.NVarChar(200), ticketData.title)
        .input('description', sql.NVarChar(sql.MAX), ticketData.description || null)
        .input('status', sql.VarChar(20), ticketData.status || 'open')
        .input('priority', sql.VarChar(20), ticketData.priority || 'medium')
        .input('createdByUserId', sql.UniqueIdentifier, ticketData.created_by_user_id)
        .input('createdByCoordinatorId', sql.UniqueIdentifier, ticketData.created_by_coordinator_id)
        .input('assignedToEngineerId', sql.UniqueIdentifier, ticketData.assigned_to_engineer_id || null)
        .input('departmentId', sql.UniqueIdentifier, employee.department_id)
        .input('locationId', sql.UniqueIdentifier, employee.location_id)
        .input('category', sql.NVarChar(100), ticketData.category || null)
        .input('ticketType', sql.NVarChar(30), ticketData.ticket_type || 'incident')
        .input('serviceType', sql.VarChar(20), ticketData.service_type || 'general')
        .input('dueDate', sql.DateTime, ticketData.due_date || null)
        .query(insertQuery);

      return result.recordset[0];
    } catch (error) {
      console.error('Error creating ticket:', error);
      throw error;
    }
  }

  /**
   * Create a new guest ticket
   * Guest tickets don't have associated user, department, or location
   */
  static async createGuestTicket(ticketData, guestData) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        // Step 1: Generate ticket number
        const ticketNumberResult = await transaction.request()
          .output('TicketNumber', sql.VarChar(20))
          .execute('sp_GenerateTicketNumber');

        const ticketNumber = ticketNumberResult.output.TicketNumber;

        // Step 2: Insert ticket with is_guest=1, created_by_user_id=NULL
        const insertTicketQuery = `
          INSERT INTO TICKETS (
            ticket_id,
            ticket_number,
            title,
            description,
            status,
            priority,
            created_by_user_id,
            created_by_coordinator_id,
            assigned_to_engineer_id,
            department_id,
            location_id,
            category,
            ticket_type,
            service_type,
            due_date,
            is_guest,
            created_at,
            updated_at
          )
          OUTPUT INSERTED.ticket_id
          VALUES (
            NEWID(),
            @ticketNumber,
            @title,
            @description,
            @status,
            @priority,
            NULL,
            @createdByCoordinatorId,
            @assignedToEngineerId,
            NULL,
            NULL,
            @category,
            @ticketType,
            @serviceType,
            @dueDate,
            1,
            GETUTCDATE(),
            GETUTCDATE()
          )
        `;

        const ticketResult = await transaction.request()
          .input('ticketNumber', sql.VarChar(20), ticketNumber)
          .input('title', sql.NVarChar(200), ticketData.title)
          .input('description', sql.NVarChar(sql.MAX), ticketData.description || null)
          .input('status', sql.VarChar(20), ticketData.status || 'open')
          .input('priority', sql.VarChar(20), ticketData.priority || 'medium')
          .input('createdByCoordinatorId', sql.UniqueIdentifier, ticketData.created_by_coordinator_id)
          .input('assignedToEngineerId', sql.UniqueIdentifier, ticketData.assigned_to_engineer_id || null)
          .input('category', sql.NVarChar(100), ticketData.category || null)
          .input('ticketType', sql.NVarChar(30), ticketData.ticket_type || 'incident')
          .input('serviceType', sql.VarChar(20), ticketData.service_type || 'general')
          .input('dueDate', sql.DateTime, ticketData.due_date || null)
          .query(insertTicketQuery);

        const ticketId = ticketResult.recordset[0].ticket_id;

        // Step 3: Insert guest information
        const insertGuestQuery = `
          INSERT INTO GUEST_TICKETS (
            guest_ticket_id,
            ticket_id,
            guest_name,
            guest_email,
            guest_phone,
            created_at,
            updated_at
          )
          VALUES (
            NEWID(),
            @ticketId,
            @guestName,
            @guestEmail,
            @guestPhone,
            GETUTCDATE(),
            GETUTCDATE()
          )
        `;

        await transaction.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .input('guestName', sql.NVarChar(100), guestData.guest_name)
          .input('guestEmail', sql.NVarChar(255), guestData.guest_email)
          .input('guestPhone', sql.NVarChar(20), guestData.guest_phone || null)
          .query(insertGuestQuery);

        await transaction.commit();

        return { ticket_id: ticketId };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error creating guest ticket:', error);
      throw error;
    }
  }

  /**
   * Get ticket by ID with all user details
   */
  static async getTicketById(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          t.*,
          -- Created By User (Employee)
          u1.first_name + ' ' + u1.last_name AS created_by_user_name,
          u1.email AS created_by_user_email,
          u1.employee_id AS created_by_user_employee_id,
          u1.role AS created_by_user_role,
          -- Coordinator
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email,
          u2.employee_id AS coordinator_employee_id,
          -- Engineer
          u3.first_name + ' ' + u3.last_name AS engineer_name,
          u3.email AS engineer_email,
          u3.employee_id AS engineer_employee_id,
          -- Department & Location
          d.department_name AS department_name,
          l.name AS location_name,
          l.address AS location_address,
          -- Guest Information
          gt.guest_name,
          gt.guest_email,
          gt.guest_phone
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN USER_MASTER u3 ON t.assigned_to_engineer_id = u3.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
        WHERE t.ticket_id = @ticketId
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error fetching ticket:', error);
      throw error;
    }
  }

  /**
   * Get tickets with filters and pagination
   */
  static async getTickets(filters = {}, pagination = {}) {
    try {
      const pool = await connectDB();

      const { page = 1, limit = 10 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE 1=1';
      const params = {};

      // Build WHERE clause based on filters
      if (filters.status) {
        whereClause += ' AND t.status = @status';
        params.status = filters.status;
      }

      if (filters.priority) {
        whereClause += ' AND t.priority = @priority';
        params.priority = filters.priority;
      }

      if (filters.category) {
        whereClause += ' AND t.category = @category';
        params.category = filters.category;
      }

      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND t.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      if (filters.assigned_to_engineer_id) {
        whereClause += ' AND t.assigned_to_engineer_id = @assignedToEngineerId';
        params.assignedToEngineerId = filters.assigned_to_engineer_id;
      }

      if (filters.created_by_user_id) {
        whereClause += ' AND t.created_by_user_id = @createdByUserId';
        params.createdByUserId = filters.created_by_user_id;
      }

      // Start Date Filter
        if (filters.start_date) {
          whereClause += ' AND CAST(t.created_at AS DATE) >= CAST(@startDate AS DATE)';
          params.startDate = filters.start_date;
        }

        // End Date Filter
        if (filters.end_date) {
          whereClause += ' AND CAST(t.created_at AS DATE) <= CAST(@endDate AS DATE)';
          params.endDate = filters.end_date;
        }

      if (filters.search) {
        whereClause += ` AND (
          t.ticket_number LIKE @search
          OR t.title LIKE @search
          OR t.description LIKE @search
          OR u1.first_name LIKE @search
          OR u1.last_name LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      // Add is_guest filter if provided
      if (filters.is_guest !== undefined) {
        whereClause += ' AND t.is_guest = @isGuest';
        params.isGuest = filters.is_guest;
      }

      // Main query
      const query = `
        SELECT
          t.*,
          -- Created By User (Employee)
          u1.first_name + ' ' + u1.last_name AS created_by_user_name,
          u1.email AS created_by_user_email,
          u1.employee_id AS created_by_user_employee_id,
          -- Coordinator
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email,
          -- Engineer
          u3.first_name + ' ' + u3.last_name AS engineer_name,
          u3.email AS engineer_email,
          u3.employee_id AS engineer_employee_id,
          -- Department & Location
          d.department_name AS department_name,
          l.name AS location_name,
          -- Guest Information
          gt.guest_name,
          gt.guest_email,
          gt.guest_phone
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN USER_MASTER u3 ON t.assigned_to_engineer_id = u3.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
        ${whereClause}
        ORDER BY t.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      // Count query
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        ${whereClause}
      `;

      // Execute queries
      let request = pool.request()
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      // old code Add filter parameters
      // Object.keys(params).forEach(key => {
      //   if (key === 'departmentId' || key === 'locationId' || key === 'assignedToEngineerId' || key === 'createdByUserId') {
      //     request.input(key, sql.UniqueIdentifier, params[key]);
      //   } else {
      //     request.input(key, sql.VarChar, params[key]);
      //   }
      // });

      // New code to add with date range filter parameters
          Object.keys(params).forEach(key => {

            if (
              key === 'departmentId' ||
              key === 'locationId' ||
              key === 'assignedToEngineerId' ||
              key === 'createdByUserId'
            ) {

              request.input(key, sql.UniqueIdentifier, params[key]);

            } else if (
              key === 'startDate' ||
              key === 'endDate'
            ) {

              request.input(key, sql.DateTime, params[key]);

            } else {

              request.input(key, sql.VarChar, params[key]);

            }
          });

      // const [ticketsResult, countResult] = await Promise.all([
      //   request.query(query),
      //   pool.request().query(countQuery.replace(whereClause, whereClause.split('AND').slice(0, -whereClause.split('AND').length + Object.keys(params).length + 1).join('AND')))
      // ]);

      let countRequest = pool.request();

        // Add count query parameters
        Object.keys(params).forEach(key => {

          if (
            key === 'departmentId' ||
            key === 'locationId' ||
            key === 'assignedToEngineerId' ||
            key === 'createdByUserId'
          ) {

            countRequest.input(key, sql.UniqueIdentifier, params[key]);

          } else if (
            key === 'startDate' ||
            key === 'endDate'
          ) {

            countRequest.input(key, sql.DateTime, params[key]);

          } else {

            countRequest.input(key, sql.VarChar, params[key]);

          }
        });

        const [ticketsResult, countResult] = await Promise.all([
          request.query(query),
          countRequest.query(countQuery)
        ]);

      return {
        tickets: ticketsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0]?.total || 0,
          pages: Math.ceil((countResult.recordset[0]?.total || 0) / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching tickets:', error);
      throw error;
    }
  }

  /**
   * Update ticket
   */
  static async updateTicket(ticketId, updateData) {
    try {
      const pool = await connectDB();

      const allowedFields = [
        'title', 'description', 'status', 'priority',
        'category', 'due_date', 'assigned_to_engineer_id',
        'resolved_at', 'closed_at', 'resolution_notes',
        'ticket_type', 'service_type'
      ];

      const updates = [];
      const params = { ticketId };

      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
          updates.push(`${key} = @${key}`);
          params[key] = updateData[key];
        }
      });

      if (updates.length === 0) {
        throw new Error('No valid fields to update');
      }

      const query = `
        UPDATE TICKETS
        SET ${updates.join(', ')}, updated_at = GETUTCDATE()
        WHERE ticket_id = @ticketId
      `;

      let request = pool.request();
      request.input('ticketId', sql.UniqueIdentifier, ticketId);

      Object.keys(params).forEach(key => {
        if (key !== 'ticketId') {
          if (key === 'assigned_to_engineer_id') {
            request.input(key, sql.UniqueIdentifier, params[key]);
          } else if (key === 'due_date' || key === 'resolved_at' || key === 'closed_at') {
            request.input(key, sql.DateTime, params[key]);
          } else if (key === 'description' || key === 'resolution_notes') {
            request.input(key, sql.NVarChar(sql.MAX), params[key]);
          } else {
            request.input(key, sql.NVarChar, params[key]);
          }
        }
      });

      await request.query(query);

      // Fetch and return the updated ticket
      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error updating ticket:', error);
      throw error;
    }
  }

  /**
   * Assign engineer to ticket
   */
  static async assignEngineer(ticketId, engineerId) {
    try {
      const pool = await connectDB();

      // Verify engineer exists and has correct role
      const engineerCheck = await pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT user_id, first_name, last_name, role, is_active
          FROM USER_MASTER
          WHERE user_id = @engineerId AND role = 'engineer' AND is_active = 1
        `);

      if (engineerCheck.recordset.length === 0) {
        throw new Error('Engineer not found or invalid');
      }

      // Update ticket - set status to in_progress when engineer is assigned
      await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          UPDATE TICKETS
          SET
            assigned_to_engineer_id = @engineerId,
            status = 'in_progress',
            updated_at = GETUTCDATE()
          WHERE ticket_id = @ticketId
        `);

      // Fetch and return the updated ticket
      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error assigning engineer:', error);
      throw error;
    }
  }

  /**
   * Close ticket
   */
  static async closeTicket(ticketId, resolutionNotes) {
    try {
      const pool = await connectDB();

      // Update the ticket - set both resolved_at and closed_at
      await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('resolutionNotes', sql.NVarChar(sql.MAX), resolutionNotes)
        .query(`
          UPDATE TICKETS
          SET
            status = 'closed',
            resolved_at = CASE WHEN resolved_at IS NULL THEN GETUTCDATE() ELSE resolved_at END,
            closed_at = GETUTCDATE(),
            resolution_notes = @resolutionNotes,
            updated_at = GETUTCDATE()
          WHERE ticket_id = @ticketId
        `);

      // Fetch and return the updated ticket
      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error closing ticket:', error);
      throw error;
    }
  }

  /**
   * Get available engineers (optionally filtered by department/location)
   */
  static async getAvailableEngineers(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE u.role = \'engineer\' AND u.is_active = 1';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND u.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND u.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      const query = `
        SELECT
          u.user_id,
          u.first_name + ' ' + u.last_name AS full_name,
          u.first_name,
          u.last_name,
          u.email,
          u.employee_id,
          u.department_id,
          u.location_id,
          d.department_name AS department_name,
          l.name AS location_name
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        LEFT JOIN locations l ON u.location_id = l.id
        ${whereClause}
        ORDER BY u.first_name, u.last_name
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching engineers:', error);
      throw error;
    }
  }

  /**
   * Get ticket statistics for dashboard
   */
  static async getTicketStats(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND location_id = @locationId';
        params.locationId = filters.location_id;
      }

      const query = `
        SELECT
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_tickets,
          SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned_tickets,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tickets,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_tickets,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          SUM(CASE WHEN priority = 'critical' OR priority = 'emergency' THEN 1 ELSE 0 END) AS critical_tickets,
          SUM(CASE WHEN due_date < GETUTCDATE() AND status NOT IN ('closed', 'resolved') THEN 1 ELSE 0 END) AS overdue_tickets,
          SUM(CASE WHEN CAST(closed_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) AS closed_today,
          SUM(CASE WHEN CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) AS today_tickets
        FROM TICKETS
        ${whereClause}
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset[0];
    } catch (error) {
      console.error('Error fetching ticket stats:', error);
      throw error;
    }
  }

  /**
   * Add comment to ticket
   */
  static async addComment(commentData) {
    try {
      const pool = await connectDB();

      const query = `
        INSERT INTO TICKET_COMMENTS (
          comment_id,
          ticket_id,
          user_id,
          comment_text,
          is_internal,
          created_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @ticketId,
          @userId,
          @commentText,
          @isInternal,
          GETUTCDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, commentData.ticket_id)
        .input('userId', sql.UniqueIdentifier, commentData.user_id)
        .input('commentText', sql.NVarChar(sql.MAX), commentData.comment_text)
        .input('isInternal', sql.Bit, commentData.is_internal || false)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }

  /**
   * Get comments for a ticket
   */
  static async getComments(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          c.*,
          u.first_name + ' ' + u.last_name AS user_name,
          u.email AS user_email,
          u.role AS user_role
        FROM TICKET_COMMENTS c
        LEFT JOIN USER_MASTER u ON c.user_id = u.user_id
        WHERE c.ticket_id = @ticketId
        ORDER BY c.created_at ASC
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching comments:', error);
      throw error;
    }
  }

  /**
   * Get dynamic filter options based on existing data
   * Returns only values that exist in the database
   */
  static async getFilterOptions() {
    try {
      const pool = await connectDB();

      // Get distinct statuses
      const statusQuery = `
        SELECT DISTINCT status
        FROM TICKETS
        WHERE status IS NOT NULL
        ORDER BY status
      `;

      // Get distinct priorities with custom order
      const priorityQuery = `
        SELECT DISTINCT priority,
          CASE priority
            WHEN 'emergency' THEN 1
            WHEN 'critical' THEN 2
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 4
            WHEN 'low' THEN 5
            ELSE 6
          END AS priority_order
        FROM TICKETS
        WHERE priority IS NOT NULL
        ORDER BY priority_order
      `;

      // Get distinct categories
      const categoryQuery = `
        SELECT DISTINCT category
        FROM TICKETS
        WHERE category IS NOT NULL
        ORDER BY category
      `;

      // Get departments that have tickets
      const departmentQuery = `
        SELECT DISTINCT d.department_id, d.department_name
        FROM DEPARTMENT_MASTER d
        INNER JOIN TICKETS t ON d.department_id = t.department_id
        WHERE d.department_name IS NOT NULL
        ORDER BY d.department_name
      `;

      // Get locations that have tickets
      const locationQuery = `
        SELECT DISTINCT l.id, l.name
        FROM locations l
        INNER JOIN TICKETS t ON l.id = t.location_id
        WHERE l.name IS NOT NULL
        ORDER BY l.name
      `;

      // Get engineers who are assigned or available
      const engineerQuery = `
        SELECT DISTINCT
          u.user_id,
          u.first_name + ' ' + u.last_name AS full_name,
          u.email,
          d.department_name
        FROM USER_MASTER u
        LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
        WHERE u.role = 'engineer' AND u.is_active = 1
        ORDER BY full_name
      `;

      // Execute all queries
      const [
        statusResult,
        priorityResult,
        categoryResult,
        departmentResult,
        locationResult,
        engineerResult
      ] = await Promise.all([
        pool.request().query(statusQuery),
        pool.request().query(priorityQuery),
        pool.request().query(categoryQuery),
        pool.request().query(departmentQuery),
        pool.request().query(locationQuery),
        pool.request().query(engineerQuery)
      ]);

      return {
        statuses: statusResult.recordset.map(r => r.status),
        priorities: priorityResult.recordset.map(r => r.priority),
        categories: categoryResult.recordset.map(r => r.category),
        departments: departmentResult.recordset.map(r => ({
          id: r.department_id,
          name: r.department_name
        })),
        locations: locationResult.recordset.map(r => ({
          id: r.id,
          name: r.name
        })),
        engineers: engineerResult.recordset.map(r => ({
          id: r.user_id,
          name: r.full_name,
          email: r.email,
          department: r.department_name
        }))
      };
    } catch (error) {
      console.error('Error fetching filter options:', error);
      throw error;
    }
  }

  /**
   * Get tickets assigned to a specific engineer
   */
  static async getEngineerTickets(engineerId, filters = {}, pagination = {}) {
    try {
      const pool = await connectDB();

      const { page = 1, limit = 10 } = pagination;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE t.assigned_to_engineer_id = @engineerId';
      const params = { engineerId };

      // Build WHERE clause based on filters
      if (filters.status) {
        whereClause += ' AND t.status = @status';
        params.status = filters.status;
      }

      if (filters.priority) {
        whereClause += ' AND t.priority = @priority';
        params.priority = filters.priority;
      }

      if (filters.search) {
        whereClause += ` AND (
          t.ticket_number LIKE @search
          OR t.title LIKE @search
          OR t.description LIKE @search
        )`;
        params.search = `%${filters.search}%`;
      }

      // Main query
      const query = `
        SELECT
          t.*,
          -- Created By User (Employee)
          u1.first_name + ' ' + u1.last_name AS created_by_user_name,
          u1.email AS created_by_user_email,
          -- Coordinator
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email,
          -- Department & Location
          d.department_name AS department_name,
          l.name AS location_name,
          -- Guest Information
          gt.guest_name,
          gt.guest_email,
          gt.guest_phone,
          -- Close Request Information
          cr.close_request_id,
          cr.request_notes AS close_request_notes,
          cr.request_status AS close_request_status,
          cr.created_at AS close_request_created_at
        FROM TICKETS t
        LEFT JOIN USER_MASTER u1 ON t.created_by_user_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_coordinator_id = u2.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
        LEFT JOIN TICKET_CLOSE_REQUESTS cr ON t.ticket_id = cr.ticket_id AND cr.request_status = 'pending'
        ${whereClause}
        ORDER BY t.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      // Count query
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM TICKETS t
        ${whereClause}
      `;

      // Execute queries
      let request = pool.request()
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .input('offset', sql.Int, offset)
        .input('limit', sql.Int, limit);

      // Add filter parameters
      Object.keys(params).forEach(key => {
        if (key !== 'engineerId') {
          request.input(key, sql.VarChar, params[key]);
        }
      });

      const [ticketsResult, countResult] = await Promise.all([
        request.query(query),
        pool.request()
          .input('engineerId', sql.UniqueIdentifier, engineerId)
          .query(countQuery)
      ]);

      return {
        tickets: ticketsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.recordset[0]?.total || 0,
          pages: Math.ceil((countResult.recordset[0]?.total || 0) / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching engineer tickets:', error);
      throw error;
    }
  }

  /**
   * Engineer requests to close a ticket
   * @param {string} ticketId - Ticket ID
   * @param {string} engineerId - Engineer ID
   * @param {string} requestNotes - Resolution notes
   * @param {string|null} serviceReportId - Service report ID (for repair/replace tickets)
   */
  static async requestTicketClose(ticketId, engineerId, requestNotes, serviceReportId = null) {
    try {
      const pool = await connectDB();

      // Check if ticket exists and is assigned to this engineer
      const ticketCheck = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .query(`
          SELECT ticket_id, status, assigned_to_engineer_id, service_type
          FROM TICKETS
          WHERE ticket_id = @ticketId
        `);

      if (ticketCheck.recordset.length === 0) {
        throw new Error('Ticket not found');
      }

      const ticket = ticketCheck.recordset[0];

      if (!ticket.assigned_to_engineer_id || ticket.assigned_to_engineer_id !== engineerId) {
        throw new Error('Ticket is not assigned to this engineer');
      }

      if (ticket.status === 'closed' || ticket.status === 'cancelled') {
        throw new Error('Ticket is already closed');
      }

      if (ticket.status === 'pending_closure') {
        throw new Error('Close request already exists for this ticket');
      }

      // Validate service report for repair/replace tickets
      if ((ticket.service_type === 'repair' || ticket.service_type === 'replace') && !serviceReportId) {
        throw new Error('Service report is required for repair/replace tickets');
      }

      // Create close request with service_report_id
      const insertQuery = `
        INSERT INTO TICKET_CLOSE_REQUESTS (
          close_request_id,
          ticket_id,
          requested_by_engineer_id,
          request_notes,
          request_status,
          service_report_id,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(),
          @ticketId,
          @engineerId,
          @requestNotes,
          'pending',
          @serviceReportId,
          GETUTCDATE(),
          GETUTCDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .input('requestNotes', sql.NVarChar(sql.MAX), requestNotes)
        .input('serviceReportId', sql.UniqueIdentifier, serviceReportId)
        .query(insertQuery);

      // Update ticket status to pending_closure
      await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          UPDATE TICKETS
          SET status = 'pending_closure', updated_at = GETUTCDATE()
          WHERE ticket_id = @ticketId
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error requesting ticket close:', error);
      throw error;
    }
  }

  /**
   * Get pending close requests for coordinators
   */
  static async getPendingCloseRequests(filters = {}) {
    try {
      const pool = await connectDB();

      // Only get requests that are pending AND ticket is still pending_closure
      let whereClause = 'WHERE cr.request_status = \'pending\' AND t.status = \'pending_closure\'';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.location_id) {
        whereClause += ' AND t.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      const query = `
        SELECT
          cr.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.status AS ticket_status,
          t.priority AS ticket_priority,
          t.service_type AS ticket_service_type,
          t.department_id,
          t.location_id,
          -- Engineer who requested
          u1.first_name + ' ' + u1.last_name AS engineer_name,
          u1.email AS engineer_email,
          -- Created By User
          u2.first_name + ' ' + u2.last_name AS created_by_user_name,
          u2.email AS created_by_user_email,
          -- Department & Location
          d.department_name,
          l.name AS location_name,
          -- Guest Info
          gt.guest_name,
          gt.guest_email,
          -- Service Report Info (if exists)
          sr.report_id AS service_report_id,
          sr.report_number AS service_report_number,
          sr.service_type AS service_report_type,
          sr.diagnosis AS service_report_diagnosis,
          sr.work_performed AS service_report_work_performed,
          sr.condition_before,
          sr.condition_after,
          sr.total_parts_cost,
          sr.labor_cost,
          sr.engineer_notes AS service_report_notes,
          sr.status AS service_report_status,
          sr.fault_type_id,
          -- Fault Type Info
          ft.name AS fault_type_name,
          ft.category AS fault_type_category
        FROM TICKET_CLOSE_REQUESTS cr
        INNER JOIN TICKETS t ON cr.ticket_id = t.ticket_id
        LEFT JOIN USER_MASTER u1 ON cr.requested_by_engineer_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON t.created_by_user_id = u2.user_id
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN GUEST_TICKETS gt ON t.ticket_id = gt.ticket_id
        LEFT JOIN SERVICE_REPORTS sr ON cr.service_report_id = sr.report_id
        LEFT JOIN FAULT_TYPES ft ON sr.fault_type_id = ft.fault_type_id
        ${whereClause}
        ORDER BY cr.created_at ASC
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching pending close requests:', error);
      throw error;
    }
  }

  /**
   * Get close request count (for badge)
   */
  static async getCloseRequestCount(filters = {}) {
    try {
      const pool = await connectDB();

      // Only count requests that are pending AND ticket is still pending_closure
      let whereClause = 'WHERE cr.request_status = \'pending\' AND t.status = \'pending_closure\'';
      const params = {};

      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      const query = `
        SELECT COUNT(*) AS count
        FROM TICKET_CLOSE_REQUESTS cr
        INNER JOIN TICKETS t ON cr.ticket_id = t.ticket_id
        ${whereClause}
      `;

      let request = pool.request();
      Object.keys(params).forEach(key => {
        request.input(key, sql.UniqueIdentifier, params[key]);
      });

      const result = await request.query(query);
      return result.recordset[0].count;
    } catch (error) {
      console.error('Error fetching close request count:', error);
      throw error;
    }
  }

  /**
   * Coordinator approves or rejects close request
   */
  static async reviewCloseRequest(closeRequestId, coordinatorId, action, reviewNotes = null) {
    try {
      const pool = await connectDB();

      // Get close request and ticket details
      const requestCheck = await pool.request()
        .input('closeRequestId', sql.UniqueIdentifier, closeRequestId)
        .query(`
          SELECT
            cr.*,
            t.ticket_id as ticket_id_from_tickets,
            t.status as ticket_status_current,
            t.service_type,
            t.assigned_to_engineer_id
          FROM TICKET_CLOSE_REQUESTS cr
          INNER JOIN TICKETS t ON cr.ticket_id = t.ticket_id
          WHERE cr.close_request_id = @closeRequestId
        `);

      if (requestCheck.recordset.length === 0) {
        throw new Error('Close request not found');
      }

      const closeRequest = requestCheck.recordset[0];

      if (closeRequest.request_status !== 'pending') {
        const status = closeRequest.request_status;
        throw new Error(`Close request has already been ${status}. Please refresh the list.`);
      }

      // Double-check ticket status
      if (closeRequest.ticket_status_current !== 'pending_closure') {
        throw new Error('Ticket is no longer in pending_closure state. Please refresh the list.');
      }

      // Use the ticket_id from the close request
      const ticketId = closeRequest.ticket_id;
      const serviceReportId = closeRequest.service_report_id;
      const serviceType = closeRequest.service_type;

      // Validation: Ensure ticketId is valid
      if (!ticketId) {
        console.error('Missing ticket_id in close request:', closeRequest);
        throw new Error('Invalid close request data: missing ticket_id');
      }

      console.log(`Processing close request ${closeRequestId} for ticket ${ticketId}, action: ${action}`);

      // Update close request
      await pool.request()
        .input('closeRequestId', sql.UniqueIdentifier, closeRequestId)
        .input('coordinatorId', sql.UniqueIdentifier, coordinatorId)
        .input('action', sql.VarChar, action)
        .input('reviewNotes', sql.NVarChar(sql.MAX), reviewNotes)
        .query(`
          UPDATE TICKET_CLOSE_REQUESTS
          SET
            request_status = @action,
            reviewed_by_coordinator_id = @coordinatorId,
            review_notes = @reviewNotes,
            reviewed_at = GETUTCDATE(),
            updated_at = GETUTCDATE()
          WHERE close_request_id = @closeRequestId
        `);

      // Update ticket based on action
      if (action === 'approved') {
        // Close the ticket
        await pool.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .input('resolutionNotes', sql.NVarChar(sql.MAX), closeRequest.request_notes)
          .query(`
            UPDATE TICKETS
            SET
              status = 'closed',
              resolved_at = CASE WHEN resolved_at IS NULL THEN GETUTCDATE() ELSE resolved_at END,
              closed_at = GETUTCDATE(),
              resolution_notes = @resolutionNotes,
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticketId
          `);

        // Stop SLA tracking - important for compliance report
        try {
          const slaResult = await SlaTrackingModel.stopTracking(ticketId, null);
          if (slaResult) {
            console.log(`SLA tracking stopped for ticket ${ticketId} - final status: ${slaResult.final_status}`);
          }
        } catch (slaError) {
          console.error('Failed to stop SLA tracking:', slaError.message);
          // Don't fail the whole operation if SLA tracking fails
        }

        // Finalize service report if exists
        if (serviceReportId) {
          try {
            const finalizedReport = await ServiceReportModel.finalizeReport(serviceReportId, coordinatorId);
            console.log(`Finalized service report ${serviceReportId}`);

            // Create or update repair history from service report (only for repair type, not replace)
            if (serviceType === 'repair' && finalizedReport && finalizedReport.asset_id) {
              // Build parts_replaced string from parts_used
              let partsReplacedStr = null;
              if (finalizedReport.parts_used && finalizedReport.parts_used.length > 0) {
                partsReplacedStr = finalizedReport.parts_used
                  .map(p => `${p.product_name || 'Part'} (${p.asset_tag || 'N/A'}) x${p.quantity}`)
                  .join(', ');
              }

              // Calculate labor hours from labor cost (assuming rate or just store null)
              const laborHours = finalizedReport.labor_cost > 0 ? null : null;

              const repairData = {
                asset_id: finalizedReport.asset_id,
                ticket_id: ticketId,
                fault_type_id: finalizedReport.fault_type_id || null,
                fault_description: finalizedReport.diagnosis,
                repair_date: new Date(),
                engineer_id: closeRequest.assigned_to_engineer_id,
                parts_replaced: partsReplacedStr,
                labor_hours: laborHours,
                parts_cost: finalizedReport.total_parts_cost || 0,
                labor_cost: finalizedReport.labor_cost || 0,
                resolution: finalizedReport.work_performed,
                repair_status: 'completed',
                notes: finalizedReport.engineer_notes,
                created_by: coordinatorId
              };

              // Check if repair history exists for this ticket (reopened ticket case)
              const repairExists = await AssetRepairHistoryModel.existsForTicket(ticketId);

              if (repairExists) {
                // Update existing repair history
                await AssetRepairHistoryModel.updateRepairEntryByTicket(ticketId, repairData, coordinatorId);
                console.log(`Updated repair history for ticket ${ticketId}`);
              } else {
                // Create new repair history
                await AssetRepairHistoryModel.createRepairEntry(repairData);
                console.log(`Created repair history for asset ${finalizedReport.asset_id}`);
              }
            }
          } catch (srError) {
            console.error('Error finalizing service report:', srError);
            // Don't fail the whole operation if service report finalization fails
          }
        }
      } else if (action === 'rejected') {
        // Return ticket to in_progress
        await pool.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .query(`
            UPDATE TICKETS
            SET
              status = 'in_progress',
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticketId
          `);

        // Delete draft service report if exists
        if (serviceReportId) {
          try {
            await ServiceReportModel.deleteDraftReport(serviceReportId);
            console.log(`Deleted draft service report ${serviceReportId}`);
          } catch (srError) {
            console.error('Error deleting draft service report:', srError);
            // Don't fail the whole operation
          }
        }
      }

      console.log(`Successfully ${action} close request ${closeRequestId}, ticket ${ticketId} status updated`);

      return await this.getTicketById(ticketId);
    } catch (error) {
      console.error('Error reviewing close request:', error);
      throw error;
    }
  }

  /**
   * Get close request history for a ticket
   */
  static async getCloseRequestHistory(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          cr.*,
          u1.first_name + ' ' + u1.last_name AS engineer_name,
          u1.email AS engineer_email,
          u2.first_name + ' ' + u2.last_name AS coordinator_name,
          u2.email AS coordinator_email
        FROM TICKET_CLOSE_REQUESTS cr
        LEFT JOIN USER_MASTER u1 ON cr.requested_by_engineer_id = u1.user_id
        LEFT JOIN USER_MASTER u2 ON cr.reviewed_by_coordinator_id = u2.user_id
        WHERE cr.ticket_id = @ticketId
        ORDER BY cr.created_at DESC
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching close request history:', error);
      throw error;
    }
  }

  /**
   * Request a service type change (engineer proposes repair/replace)
   */
  static async requestServiceTypeChange(ticketId, engineerId, proposedServiceType, requestNotes = null) {
    try {
      const pool = await connectDB();

      // Check ticket exists and is assigned to this engineer
      const ticketCheck = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT ticket_id, status, assigned_to_engineer_id, service_type, ticket_type
          FROM TICKETS
          WHERE ticket_id = @ticketId
        `);

      if (ticketCheck.recordset.length === 0) {
        throw new Error('Ticket not found');
      }

      const ticket = ticketCheck.recordset[0];

      if (!ticket.assigned_to_engineer_id || ticket.assigned_to_engineer_id !== engineerId) {
        throw new Error('Ticket is not assigned to this engineer');
      }

      if (ticket.status === 'closed' || ticket.status === 'cancelled') {
        throw new Error('Ticket is already closed');
      }

      if (ticket.service_type !== 'general') {
        throw new Error('Service type has already been set');
      }

      // Check no pending request already exists
      const pendingCheck = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT request_id FROM TICKET_SERVICE_TYPE_REQUESTS
          WHERE ticket_id = @ticketId AND request_status = 'pending'
        `);

      if (pendingCheck.recordset.length > 0) {
        throw new Error('A pending service type change request already exists for this ticket');
      }

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('engineerId', sql.UniqueIdentifier, engineerId)
        .input('proposedServiceType', sql.VarChar(20), proposedServiceType)
        .input('requestNotes', sql.NVarChar(sql.MAX), requestNotes)
        .query(`
          INSERT INTO TICKET_SERVICE_TYPE_REQUESTS (
            request_id, ticket_id, requested_by_engineer_id,
            proposed_service_type, request_notes, request_status,
            created_at, updated_at
          )
          OUTPUT INSERTED.*
          VALUES (
            NEWID(), @ticketId, @engineerId,
            @proposedServiceType, @requestNotes, 'pending',
            GETUTCDATE(), GETUTCDATE()
          )
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error requesting service type change:', error);
      throw error;
    }
  }

  /**
   * Review a service type change request (coordinator approves/rejects)
   */
  static async reviewServiceTypeChange(requestId, coordinatorId, action, reviewNotes = null) {
    try {
      const pool = await connectDB();

      // Get the request
      console.log('reviewServiceTypeChange called with requestId:', requestId);
      const requestCheck = await pool.request()
        .input('requestId', sql.UniqueIdentifier, requestId)
        .query(`
          SELECT r.request_id, r.ticket_id, r.requested_by_engineer_id,
                 r.proposed_service_type, r.request_notes, r.request_status,
                 t.ticket_number, t.service_type AS current_service_type, t.title
          FROM TICKET_SERVICE_TYPE_REQUESTS r
          JOIN TICKETS t ON r.ticket_id = t.ticket_id
          WHERE r.request_id = @requestId
        `);

      if (requestCheck.recordset.length === 0) {
        throw new Error('Service type change request not found');
      }

      const request = requestCheck.recordset[0];

      if (request.request_status !== 'pending') {
        throw new Error('This request has already been reviewed');
      }

      // Update the request
      await pool.request()
        .input('requestId', sql.UniqueIdentifier, requestId)
        .input('coordinatorId', sql.UniqueIdentifier, coordinatorId)
        .input('action', sql.VarChar(20), action)
        .input('reviewNotes', sql.NVarChar(sql.MAX), reviewNotes)
        .query(`
          UPDATE TICKET_SERVICE_TYPE_REQUESTS
          SET request_status = @action,
              reviewed_by_coordinator_id = @coordinatorId,
              review_notes = @reviewNotes,
              reviewed_at = GETUTCDATE(),
              updated_at = GETUTCDATE()
          WHERE request_id = @requestId
        `);

      if (action === 'approved') {
        // Update ticket service_type
        await pool.request()
          .input('ticketId', sql.UniqueIdentifier, request.ticket_id)
          .input('serviceType', sql.VarChar(20), request.proposed_service_type)
          .query(`
            UPDATE TICKETS
            SET service_type = @serviceType, updated_at = GETUTCDATE()
            WHERE ticket_id = @ticketId
          `);

        // Auto-create draft service report (only if no active report exists)
        try {
          const activeReportCheck = await pool.request()
            .input('ticketId', sql.UniqueIdentifier, request.ticket_id)
            .query(`
              SELECT report_id FROM SERVICE_REPORTS
              WHERE ticket_id = @ticketId AND status IN ('draft', 'finalized')
            `);

          if (activeReportCheck.recordset.length === 0) {
            const reportData = {
              ticket_id: request.ticket_id,
              service_type: request.proposed_service_type,
              asset_id: null,
              replacement_asset_id: null,
              fault_type_id: null,
              diagnosis: null,
              work_performed: null,
              condition_before: null,
              condition_after: null,
              parts_used: null,
              labor_cost: null,
              engineer_notes: null,
              created_by: request.requested_by_engineer_id
            };
            await ServiceReportModel.createDraftReport(reportData);
            console.log(`Auto-created draft service report for ticket ${request.ticket_number} (service_type approved: ${request.proposed_service_type})`);
          } else {
            console.log(`Skipped draft report creation for ticket ${request.ticket_number} - active report already exists`);
          }
        } catch (reportError) {
          console.error('Failed to auto-create draft service report:', reportError.message);
        }
      }

      return await this.getTicketById(request.ticket_id);
    } catch (error) {
      console.error('Error reviewing service type change:', error);
      throw error;
    }
  }

  /**
   * Get pending service type change requests (for coordinators)
   */
  static async getPendingServiceTypeRequests() {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .query(`
          SELECT r.*,
            t.ticket_number, t.title, t.status AS ticket_status, t.priority, t.service_type AS current_service_type,
            u.first_name + ' ' + u.last_name AS engineer_name, u.email AS engineer_email
          FROM TICKET_SERVICE_TYPE_REQUESTS r
          JOIN TICKETS t ON r.ticket_id = t.ticket_id
          JOIN USER_MASTER u ON r.requested_by_engineer_id = u.user_id
          WHERE r.request_status = 'pending'
          ORDER BY r.created_at DESC
        `);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching pending service type requests:', error);
      throw error;
    }
  }

  /**
   * Get service type change request history for a ticket
   */
  static async getServiceTypeRequestsByTicketId(ticketId) {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT r.*,
            u1.first_name + ' ' + u1.last_name AS engineer_name,
            u2.first_name + ' ' + u2.last_name AS coordinator_name
          FROM TICKET_SERVICE_TYPE_REQUESTS r
          LEFT JOIN USER_MASTER u1 ON r.requested_by_engineer_id = u1.user_id
          LEFT JOIN USER_MASTER u2 ON r.reviewed_by_coordinator_id = u2.user_id
          WHERE r.ticket_id = @ticketId
          ORDER BY r.created_at DESC
        `);
      return result.recordset;
    } catch (error) {
      console.error('Error fetching service type requests:', error);
      throw error;
    }
  }

  /**
   * Get ticket trend analysis
   * Analyzes ticket volume trends over specified months, grouped by category
   * @param {Object} filters - Optional filters (months_back, location_id, department_id)
   * @returns {Object} Trend data with monthly volume and category breakdown
   */
  static async getTicketTrendAnalysis(filters = {}) {
    try {
      const pool = await connectDB();

      const monthsBack = filters.months_back || 6;

      // Build WHERE clause for filters
      let whereClause = `WHERE t.created_at >= DATEADD(MONTH, -@monthsBack, GETUTCDATE())`;
      const params = { monthsBack };

      if (filters.location_id) {
        whereClause += ' AND t.location_id = @locationId';
        params.locationId = filters.location_id;
      }

      if (filters.department_id) {
        whereClause += ' AND t.department_id = @departmentId';
        params.departmentId = filters.department_id;
      }

      if (filters.priority) {
        whereClause += ' AND t.priority = @priority';
        params.priority = filters.priority;
      }

      if (filters.engineer_id) {
        whereClause += ' AND t.assigned_to_engineer_id = @engineerId';
        params.engineerId = filters.engineer_id;
      }

      // Query 1: Monthly ticket volume
      const monthlyVolumeQuery = `
        SELECT
          YEAR(t.created_at) AS year,
          MONTH(t.created_at) AS month,
          FORMAT(t.created_at, 'yyyy-MM') AS period,
          DATENAME(MONTH, t.created_at) + ' ' + CAST(YEAR(t.created_at) AS VARCHAR) AS period_label,
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          SUM(CASE WHEN t.status IN ('open', 'in_progress', 'assigned', 'pending_closure') THEN 1 ELSE 0 END) AS active_tickets,
          SUM(CASE WHEN t.priority IN ('critical', 'emergency') THEN 1 ELSE 0 END) AS critical_tickets,
          AVG(CASE
            WHEN t.closed_at IS NOT NULL
            THEN DATEDIFF(HOUR, t.created_at, t.closed_at)
            ELSE NULL
          END) AS avg_resolution_hours
        FROM TICKETS t
        ${whereClause}
        GROUP BY YEAR(t.created_at), MONTH(t.created_at),
                 FORMAT(t.created_at, 'yyyy-MM'),
                 DATENAME(MONTH, t.created_at) + ' ' + CAST(YEAR(t.created_at) AS VARCHAR)
        ORDER BY YEAR(t.created_at), MONTH(t.created_at)
      `;

      // Query 2: Category breakdown
      const categoryBreakdownQuery = `
        SELECT
          COALESCE(t.category, 'Uncategorized') AS category,
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          SUM(CASE WHEN t.status IN ('open', 'in_progress', 'assigned', 'pending_closure') THEN 1 ELSE 0 END) AS active_tickets,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage
        FROM TICKETS t
        ${whereClause}
        GROUP BY COALESCE(t.category, 'Uncategorized')
        ORDER BY total_tickets DESC
      `;

      // Query 3: Priority breakdown
      const priorityBreakdownQuery = `
        SELECT
          t.priority,
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage
        FROM TICKETS t
        ${whereClause}
        GROUP BY t.priority
        ORDER BY
          CASE t.priority
            WHEN 'emergency' THEN 1
            WHEN 'critical' THEN 2
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 4
            WHEN 'low' THEN 5
            ELSE 6
          END
      `;

      // Query 4: Category by month (for heatmap/detailed view)
      const categoryByMonthQuery = `
        SELECT
          FORMAT(t.created_at, 'yyyy-MM') AS period,
          COALESCE(t.category, 'Uncategorized') AS category,
          COUNT(*) AS ticket_count
        FROM TICKETS t
        ${whereClause}
        GROUP BY FORMAT(t.created_at, 'yyyy-MM'), COALESCE(t.category, 'Uncategorized')
        ORDER BY period, category
      `;

      // Query 5: Status distribution
      const statusBreakdownQuery = `
        SELECT
          t.status,
          COUNT(*) AS total_tickets,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage
        FROM TICKETS t
        ${whereClause}
        GROUP BY t.status
        ORDER BY total_tickets DESC
      `;

      // Query 6: Location breakdown
      const locationBreakdownQuery = `
        SELECT
          COALESCE(l.name, 'Unknown') AS location_name,
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage
        FROM TICKETS t
        LEFT JOIN locations l ON t.location_id = l.id
        ${whereClause}
        GROUP BY COALESCE(l.name, 'Unknown')
        ORDER BY total_tickets DESC
      `;

      // Query 7: Department breakdown
      const departmentBreakdownQuery = `
        SELECT
          COALESCE(d.department_name, 'Unknown') AS department_name,
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage
        FROM TICKETS t
        LEFT JOIN DEPARTMENT_MASTER d ON t.department_id = d.department_id
        ${whereClause}
        GROUP BY COALESCE(d.department_name, 'Unknown')
        ORDER BY total_tickets DESC
      `;

      // Query 8: Engineer breakdown
      const engineerBreakdownQuery = `
        SELECT
          COALESCE(u.first_name + ' ' + u.last_name, 'Unassigned') AS engineer_name,
          t.assigned_to_engineer_id AS engineer_id,
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          SUM(CASE WHEN t.status IN ('open', 'in_progress', 'assigned', 'pending_closure') THEN 1 ELSE 0 END) AS active_tickets,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS percentage,
          AVG(CASE
            WHEN t.closed_at IS NOT NULL
            THEN DATEDIFF(HOUR, t.created_at, t.closed_at)
            ELSE NULL
          END) AS avg_resolution_hours
        FROM TICKETS t
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        ${whereClause}
        GROUP BY t.assigned_to_engineer_id, u.first_name, u.last_name
        ORDER BY total_tickets DESC
      `;

      // Query 9: Summary statistics
      const summaryQuery = `
        SELECT
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_tickets,
          SUM(CASE WHEN t.status IN ('open', 'in_progress', 'assigned', 'pending_closure') THEN 1 ELSE 0 END) AS active_tickets,
          SUM(CASE WHEN t.priority IN ('critical', 'emergency') THEN 1 ELSE 0 END) AS critical_tickets,
          AVG(CASE
            WHEN t.closed_at IS NOT NULL
            THEN DATEDIFF(HOUR, t.created_at, t.closed_at)
            ELSE NULL
          END) AS avg_resolution_hours,
          COUNT(DISTINCT t.category) AS unique_categories,
          COUNT(DISTINCT t.location_id) AS unique_locations,
          COUNT(DISTINCT t.department_id) AS unique_departments
        FROM TICKETS t
        ${whereClause}
      `;

      // Build requests with parameters
      const buildRequest = (query) => {
        let request = pool.request().input('monthsBack', sql.Int, monthsBack);

        if (params.locationId) {
          request.input('locationId', sql.UniqueIdentifier, params.locationId);
        }
        if (params.departmentId) {
          request.input('departmentId', sql.UniqueIdentifier, params.departmentId);
        }
        if (params.priority) {
          request.input('priority', sql.VarChar, params.priority);
        }
        if (params.engineerId) {
          request.input('engineerId', sql.UniqueIdentifier, params.engineerId);
        }

        return request.query(query);
      };

      // Execute all queries in parallel
      const [
        monthlyVolumeResult,
        categoryResult,
        priorityResult,
        categoryByMonthResult,
        statusResult,
        locationResult,
        departmentResult,
        engineerResult,
        summaryResult
      ] = await Promise.all([
        buildRequest(monthlyVolumeQuery),
        buildRequest(categoryBreakdownQuery),
        buildRequest(priorityBreakdownQuery),
        buildRequest(categoryByMonthQuery),
        buildRequest(statusBreakdownQuery),
        buildRequest(locationBreakdownQuery),
        buildRequest(departmentBreakdownQuery),
        buildRequest(engineerBreakdownQuery),
        buildRequest(summaryQuery)
      ]);

      // Calculate month-over-month change
      const monthlyData = monthlyVolumeResult.recordset;
      const monthlyWithChange = monthlyData.map((month, index) => {
        let change = null;
        let changePercent = null;

        if (index > 0) {
          const prevMonth = monthlyData[index - 1];
          change = month.total_tickets - prevMonth.total_tickets;
          changePercent = prevMonth.total_tickets > 0
            ? Math.round((change / prevMonth.total_tickets) * 100 * 100) / 100
            : null;
        }

        return {
          ...month,
          change,
          change_percent: changePercent
        };
      });

      return {
        summary: summaryResult.recordset[0],
        monthly_volume: monthlyWithChange,
        by_category: categoryResult.recordset,
        by_priority: priorityResult.recordset,
        by_status: statusResult.recordset,
        by_location: locationResult.recordset,
        by_department: departmentResult.recordset,
        by_engineer: engineerResult.recordset,
        category_by_month: categoryByMonthResult.recordset,
        filters_applied: {
          months_back: monthsBack,
          location_id: filters.location_id || null,
          department_id: filters.department_id || null,
          priority: filters.priority || null,
          engineer_id: filters.engineer_id || null
        }
      };
    } catch (error) {
      console.error('Error fetching ticket trend analysis:', error);
      throw error;
    }
  }

  /**
   * Get ticket reopen configuration
   */
  static async getReopenConfig() {
    try {
      const pool = await connectDB();
      const result = await pool.request().query(`
        SELECT TOP 1 * FROM TICKET_REOPEN_CONFIG WHERE is_active = 1
      `);
      return result.recordset[0] || null;
    } catch (error) {
      console.error('Error fetching reopen config:', error);
      throw error;
    }
  }

  /**
   * Update ticket reopen configuration
   */
  static async updateReopenConfig(configData, updatedBy) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('reopenWindowDays', sql.Int, configData.reopen_window_days)
        .input('maxReopenCount', sql.Int, configData.max_reopen_count)
        .input('slaResetMode', sql.VarChar(20), configData.sla_reset_mode)
        .input('requireReopenReason', sql.Bit, configData.require_reopen_reason)
        .input('notifyAssignee', sql.Bit, configData.notify_assignee)
        .input('notifyManager', sql.Bit, configData.notify_manager)
        .input('updatedBy', sql.UniqueIdentifier, updatedBy)
        .query(`
          UPDATE TICKET_REOPEN_CONFIG
          SET
            reopen_window_days = @reopenWindowDays,
            max_reopen_count = @maxReopenCount,
            sla_reset_mode = @slaResetMode,
            require_reopen_reason = @requireReopenReason,
            notify_assignee = @notifyAssignee,
            notify_manager = @notifyManager,
            updated_by = @updatedBy,
            updated_at = GETUTCDATE()
          WHERE is_active = 1;

          SELECT TOP 1 * FROM TICKET_REOPEN_CONFIG WHERE is_active = 1;
        `);

      return result.recordset[0];
    } catch (error) {
      console.error('Error updating reopen config:', error);
      throw error;
    }
  }

  /**
   * Check if a ticket can be reopened
   */
  static async canReopenTicket(ticketId) {
    try {
      const pool = await connectDB();

      // Get ticket and config
      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT
            t.ticket_id,
            t.ticket_number,
            t.status,
            t.closed_at,
            t.reopen_count,
            t.service_type,
            c.reopen_window_days,
            c.max_reopen_count,
            c.require_reopen_reason,
            DATEDIFF(DAY, t.closed_at, GETUTCDATE()) AS days_since_closed
          FROM TICKETS t
          CROSS JOIN (SELECT TOP 1 * FROM TICKET_REOPEN_CONFIG WHERE is_active = 1) c
          WHERE t.ticket_id = @ticketId
        `);

      if (result.recordset.length === 0) {
        return { canReopen: false, reason: 'Ticket not found' };
      }

      const ticket = result.recordset[0];

      if (ticket.status !== 'closed') {
        return { canReopen: false, reason: 'Ticket is not closed' };
      }

      if (ticket.reopen_count >= ticket.max_reopen_count) {
        return {
          canReopen: false,
          reason: `Maximum reopen limit (${ticket.max_reopen_count}) reached`
        };
      }

      if (ticket.days_since_closed > ticket.reopen_window_days) {
        return {
          canReopen: false,
          reason: `Reopen window (${ticket.reopen_window_days} days) has expired`
        };
      }

      return {
        canReopen: true,
        ticket,
        remainingReopens: ticket.max_reopen_count - ticket.reopen_count,
        daysRemaining: ticket.reopen_window_days - ticket.days_since_closed
      };
    } catch (error) {
      console.error('Error checking reopen eligibility:', error);
      throw error;
    }
  }

  /**
   * Reopen a closed ticket
   */
  static async reopenTicket(ticketId, reopenedBy, reopenReason) {
    try {
      const pool = await connectDB();

      // First check if can reopen
      const eligibility = await this.canReopenTicket(ticketId);
      if (!eligibility.canReopen) {
        throw new Error(eligibility.reason);
      }

      const ticket = eligibility.ticket;

      // Get reopen config for SLA handling
      const config = await this.getReopenConfig();

      // Start transaction
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        // 1. Record reopen in history
        await transaction.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .input('reopenNumber', sql.Int, ticket.reopen_count + 1)
          .input('reopenReason', sql.NVarChar(sql.MAX), reopenReason)
          .input('reopenedBy', sql.UniqueIdentifier, reopenedBy)
          .input('previousClosedAt', sql.DateTime, ticket.closed_at)
          .query(`
            INSERT INTO TICKET_REOPEN_HISTORY (
              ticket_id, reopen_number, reopen_reason, reopened_by,
              previous_closed_at, reopened_at, created_at
            ) VALUES (
              @ticketId, @reopenNumber, @reopenReason, @reopenedBy,
              @previousClosedAt, GETUTCDATE(), GETUTCDATE()
            )
          `);

        // 2. Update ticket status, reopen count, and reset service_type to general
        await transaction.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .input('reopenedBy', sql.UniqueIdentifier, reopenedBy)
          .query(`
            UPDATE TICKETS
            SET
              status = 'in_progress',
              service_type = 'general',
              reopen_count = reopen_count + 1,
              last_reopened_at = GETUTCDATE(),
              last_reopened_by = @reopenedBy,
              original_closed_at = CASE
                WHEN original_closed_at IS NULL THEN closed_at
                ELSE original_closed_at
              END,
              closed_at = NULL,
              resolved_at = NULL,
              updated_at = GETUTCDATE()
            WHERE ticket_id = @ticketId
          `);

        // 2b. Cancel any pending service type change requests for this ticket
        await transaction.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .query(`
            UPDATE TICKET_SERVICE_TYPE_REQUESTS
            SET request_status = 'cancelled',
                review_notes = 'Auto-cancelled: ticket was reopened',
                reviewed_at = GETUTCDATE(),
                updated_at = GETUTCDATE()
            WHERE ticket_id = @ticketId AND request_status = 'pending'
          `);

        // 3. Cancel draft service reports (auto-created by service type approval, not yet filled)
        //    Finalized reports are kept as-is — they are valid historical records
        await transaction.request()
          .input('ticketId', sql.UniqueIdentifier, ticketId)
          .query(`
            UPDATE SERVICE_REPORTS
            SET status = 'cancelled', updated_at = GETUTCDATE()
            WHERE ticket_id = @ticketId AND status = 'draft'
          `);

        await transaction.commit();

        // 4. Handle SLA based on reset mode
        const slaResetMode = config?.sla_reset_mode || 'continue';

        try {
          if (slaResetMode === 'reset') {
            // Delete existing SLA tracking and re-initialize
            await pool.request()
              .input('ticketId', sql.UniqueIdentifier, ticketId)
              .query(`DELETE FROM TICKET_SLA_TRACKING WHERE ticket_id = @ticketId`);

            // Get ticket context for new SLA
            const reopenedTicket = await this.getTicketById(ticketId);

            // Get linked assets
            const assetsResult = await pool.request()
              .input('ticketId', sql.UniqueIdentifier, ticketId)
              .query(`SELECT asset_id FROM TICKET_ASSETS WHERE ticket_id = @ticketId`);

            const assetIds = assetsResult.recordset.map(a => a.asset_id);

            // Re-initialize SLA tracking
            await SlaTrackingModel.initializeTracking(ticketId, {
              ticket_id: ticketId,
              ticket_type: reopenedTicket.ticket_type || 'internal',
              service_type: reopenedTicket.service_type || 'general',
              ticket_channel: 'portal',
              priority: reopenedTicket.priority || 'medium',
              user_id: reopenedTicket.created_by_user_id,
              asset_ids: assetIds
            });

            console.log(`SLA reset for ticket ${ticketId} - new tracking initialized`);
          } else if (slaResetMode === 'continue') {
            // Resume SLA timer if paused
            const tracking = await SlaTrackingModel.getTracking(ticketId);
            if (tracking && tracking.is_paused) {
              await SlaTrackingModel.resumeTimer(ticketId, reopenedBy);
              console.log(`SLA resumed for ticket ${ticketId}`);
            } else if (tracking) {
              // Update status and clear resolution fields so ticket is active again
              await pool.request()
                .input('ticketId', sql.UniqueIdentifier, ticketId)
                .query(`
                  UPDATE TICKET_SLA_TRACKING
                  SET sla_status = CASE
                    WHEN business_elapsed_minutes >= (SELECT max_tat_minutes FROM SLA_RULES WHERE rule_id = sla_rule_id) THEN 'breached'
                    WHEN business_elapsed_minutes >= (SELECT avg_tat_minutes FROM SLA_RULES WHERE rule_id = sla_rule_id) THEN 'critical'
                    WHEN business_elapsed_minutes >= (SELECT min_tat_minutes FROM SLA_RULES WHERE rule_id = sla_rule_id) THEN 'warning'
                    ELSE 'on_track'
                  END,
                  resolved_at = NULL,
                  final_status = NULL,
                  updated_at = GETUTCDATE()
                  WHERE ticket_id = @ticketId
                `);
              console.log(`SLA continued for ticket ${ticketId}`);
            }
          } else if (slaResetMode === 'new_sla') {
            // Keep history but calculate new target times from now
            const tracking = await SlaTrackingModel.getTracking(ticketId);
            if (tracking) {
              // Get the SLA rule to recalculate targets
              const ruleResult = await pool.request()
                .input('ruleId', sql.UniqueIdentifier, tracking.sla_rule_id)
                .query(`SELECT * FROM SLA_RULES WHERE rule_id = @ruleId`);

              if (ruleResult.recordset.length > 0) {
                const rule = ruleResult.recordset[0];
                const now = new Date();

                // Calculate new target times
                const minTarget = new Date(now.getTime() + rule.min_tat_minutes * 60000);
                const avgTarget = new Date(now.getTime() + rule.avg_tat_minutes * 60000);
                const maxTarget = new Date(now.getTime() + rule.max_tat_minutes * 60000);

                await pool.request()
                  .input('ticketId', sql.UniqueIdentifier, ticketId)
                  .input('minTarget', sql.DateTime, minTarget)
                  .input('avgTarget', sql.DateTime, avgTarget)
                  .input('maxTarget', sql.DateTime, maxTarget)
                  .query(`
                    UPDATE TICKET_SLA_TRACKING
                    SET
                      sla_start_time = GETUTCDATE(),
                      min_target_time = @minTarget,
                      avg_target_time = @avgTarget,
                      max_target_time = @maxTarget,
                      business_elapsed_minutes = 0,
                      total_paused_minutes = 0,
                      is_paused = 0,
                      pause_started_at = NULL,
                      current_pause_reason = NULL,
                      sla_status = 'on_track',
                      resolved_at = NULL,
                      final_status = NULL,
                      warning_triggered_at = NULL,
                      breach_triggered_at = NULL,
                      updated_at = GETUTCDATE()
                    WHERE ticket_id = @ticketId
                  `);
                console.log(`New SLA targets set for ticket ${ticketId}`);
              }
            }
          }
        } catch (slaError) {
          console.error('Error handling SLA on reopen:', slaError);
          // Don't throw - ticket is already reopened, just log the SLA error
        }

        return await this.getTicketById(ticketId);
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (error) {
      console.error('Error reopening ticket:', error);
      throw error;
    }
  }

  /**
   * Get reopen history for a ticket
   */
  static async getReopenHistory(ticketId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT
            rh.*,
            u.first_name + ' ' + u.last_name AS reopened_by_name,
            u.email AS reopened_by_email
          FROM TICKET_REOPEN_HISTORY rh
          LEFT JOIN USER_MASTER u ON rh.reopened_by = u.user_id
          WHERE rh.ticket_id = @ticketId
          ORDER BY rh.reopen_number DESC
        `);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching reopen history:', error);
      throw error;
    }
  }
}

module.exports = TicketModel;
