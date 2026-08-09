/**
 * SLA TRACKING MODEL
 * Handles all database operations for ticket SLA tracking
 */

const { connectDB, sql } = require('../config/database');
const businessHoursCalculator = require('../utils/businessHoursCalculator');
const slaMatchingEngine = require('../services/slaMatchingEngine');

class SlaTrackingModel {
  /**
   * Initialize SLA tracking for a ticket
   * @param {string} ticketId - Ticket ID
   * @param {Object} ticketContext - Context for SLA matching
   */
  static async initializeTracking(ticketId, ticketContext) {
    try {
      const pool = await connectDB();

      // Check if tracking already exists
      const existingResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query('SELECT tracking_id FROM TICKET_SLA_TRACKING WHERE ticket_id = @ticketId');

      if (existingResult.recordset.length > 0) {
        throw new Error('SLA tracking already exists for this ticket');
      }

      // Find matching SLA rule
      const matchResult = await slaMatchingEngine.findMatchingRule(ticketContext);
      const rule = matchResult.rule;

      // Calculate deadlines
      // Calculate deadlines using the actual ticket creation time
      const ticketResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT created_at
          FROM TICKETS
          WHERE ticket_id = @ticketId
        `);
      
      if (ticketResult.recordset.length === 0) {
        throw new Error('Ticket not found while initializing SLA tracking');
      }
      
      const now = new Date(ticketResult.recordset[0].created_at);
      const minDeadline = await businessHoursCalculator.calculateDeadline(
        now,
        rule.min_tat_minutes,
        rule.business_hours_schedule_id,
        rule.holiday_calendar_id
      );
      const avgDeadline = await businessHoursCalculator.calculateDeadline(
        now,
        rule.avg_tat_minutes,
        rule.business_hours_schedule_id,
        rule.holiday_calendar_id
      );
      const maxDeadline = await businessHoursCalculator.calculateDeadline(
        now,
        rule.max_tat_minutes,
        rule.business_hours_schedule_id,
        rule.holiday_calendar_id
      );

      // Parse pause conditions
      let pauseConditions = {};
      try {
        pauseConditions = JSON.parse(rule.pause_conditions || '{}');
      } catch (e) {
        pauseConditions = {};
      }

      // Create tracking record
      const query = `
        INSERT INTO TICKET_SLA_TRACKING (
          tracking_id, ticket_id, sla_rule_id, sla_start_time,
          min_target_time, avg_target_time, max_target_time,
          business_elapsed_minutes, total_paused_minutes,
          is_paused, pause_started_at, sla_status,
          created_at
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @ticketId, @slaRuleId, @slaStartTime,
          @minDeadline, @avgDeadline, @maxDeadline,
          0, 0,
          0, NULL, 'on_track',
          GETUTCDATE()
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('slaRuleId', sql.UniqueIdentifier, rule.rule_id)
        .input('slaStartTime', sql.DateTime, now)
        .input('minDeadline', sql.DateTime, minDeadline)
        .input('avgDeadline', sql.DateTime, avgDeadline)
        .input('maxDeadline', sql.DateTime, maxDeadline)
        .query(query);

      return {
        tracking: result.recordset[0],
        rule: rule,
        escalation_rules: matchResult.escalation_rules
      };
    } catch (error) {
      console.error('Error initializing SLA tracking:', error);
      throw error;
    }
  }

  /**
   * Get SLA tracking for a ticket
   */
  static async getTracking(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          tst.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.priority AS ticket_priority,
          sr.rule_name,
          sr.rule_name AS sla_rule_name,
          sr.description AS rule_description,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          sr.business_hours_schedule_id,
          sr.holiday_calendar_id,
          sr.allow_pause_resume,
          sr.pause_conditions,
          bhs.schedule_name AS business_hours_name,
          hc.calendar_name AS holiday_calendar_name
        FROM TICKET_SLA_TRACKING tst
        INNER JOIN TICKETS t ON tst.ticket_id = t.ticket_id
        INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
        LEFT JOIN BUSINESS_HOURS_SCHEDULES bhs ON sr.business_hours_schedule_id = bhs.schedule_id
        LEFT JOIN HOLIDAY_CALENDARS hc ON sr.holiday_calendar_id = hc.calendar_id
        WHERE tst.ticket_id = @ticketId
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      if (result.recordset.length === 0) {
        return null;
      }

      return result.recordset[0];
    } catch (error) {
      console.error('Error getting SLA tracking:', error);
      throw error;
    }
  }

  /**
   * Update elapsed time for a ticket
   */
  static async updateElapsedTime(ticketId) {
    try {
      const pool = await connectDB();

      // Get tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        throw new Error('SLA tracking not found for ticket');
      }

      // If ticket is closed or SLA stopped, don't update
      if (tracking.resolved_at) {
        return tracking;
      }

      // Get pause periods from action log (pair pause/resume actions)
      const pauseResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .query(`
          SELECT
            p.action_at as pause_start,
            r.action_at as pause_end
          FROM TICKET_SLA_PAUSE_LOG p
          LEFT JOIN TICKET_SLA_PAUSE_LOG r ON p.tracking_id = r.tracking_id
            AND r.action = 'resumed'
            AND r.action_at > p.action_at
            AND NOT EXISTS (
              SELECT 1 FROM TICKET_SLA_PAUSE_LOG p2
              WHERE p2.tracking_id = p.tracking_id
                AND p2.action = 'paused'
                AND p2.action_at > p.action_at
                AND p2.action_at < r.action_at
            )
          WHERE p.tracking_id = @trackingId
            AND p.action = 'paused'
            AND r.action_at IS NOT NULL
        `);

      const pausePeriods = pauseResult.recordset;

      // Calculate elapsed business minutes
      const endTime = tracking.is_paused ? new Date(tracking.pause_started_at) : new Date();
      const elapsedMinutes = await businessHoursCalculator.calculateElapsedMinutes(
        new Date(tracking.sla_start_time),
        endTime,
        tracking.business_hours_schedule_id,
        tracking.holiday_calendar_id,
        pausePeriods
      );

      // Calculate SLA status
      const slaStatus = businessHoursCalculator.calculateSlaStatus(
        elapsedMinutes,
        tracking.min_tat_minutes,
        tracking.avg_tat_minutes,
        tracking.max_tat_minutes
      );

      // Check if this is a new breach (status becoming breached for the first time)
      const isNewBreach = slaStatus.status === 'breached' && tracking.sla_status !== 'breached';

      // Update tracking record - set breach_triggered_at only on first breach
      const updateQuery = `
        UPDATE TICKET_SLA_TRACKING SET
          business_elapsed_minutes = @elapsedMinutes,
          sla_status = @slaStatus,
          breach_triggered_at = CASE
            WHEN @isNewBreach = 1 AND breach_triggered_at IS NULL THEN GETUTCDATE()
            ELSE breach_triggered_at
          END,
          last_calculated_at = GETUTCDATE(),
          updated_at = GETUTCDATE()
        OUTPUT INSERTED.*
        WHERE tracking_id = @trackingId
      `;

      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('elapsedMinutes', sql.Int, elapsedMinutes)
        .input('slaStatus', sql.NVarChar(20), slaStatus.status)
        .input('isNewBreach', sql.Bit, isNewBreach ? 1 : 0)
        .query(updateQuery);

      // Return full tracking data with SLA rule details
      const fullTracking = await this.getTracking(ticketId);
      return {
        ...fullTracking,
        sla_status_details: slaStatus
      };
    } catch (error) {
      console.error('Error updating elapsed time:', error);
      throw error;
    }
  }

  /**
   * Pause SLA timer
   */
  static async pauseTimer(ticketId, reason, pausedBy) {
    try {
      const pool = await connectDB();

      // Get tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        throw new Error('SLA tracking not found for ticket');
      }

      if (tracking.is_paused) {
        throw new Error('SLA timer is already paused');
      }

      if (!tracking.allow_pause_resume) {
        throw new Error('Pause/resume is not allowed for this SLA rule');
      }

      const now = new Date();

      // Update tracking to paused
      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('currentPauseStart', sql.DateTime, now)
        .input('pauseReason', sql.NVarChar(500), reason)
        .query(`
          UPDATE TICKET_SLA_TRACKING SET
            is_paused = 1,
            pause_started_at = @currentPauseStart,
            current_pause_reason = @pauseReason,
            updated_at = GETUTCDATE()
          WHERE tracking_id = @trackingId
        `);

      // Create pause log entry
      const logQuery = `
        INSERT INTO TICKET_SLA_PAUSE_LOG (
          log_id, tracking_id, action, reason, action_at, created_by
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @trackingId, 'paused', @pauseReason, GETUTCDATE(), @pausedBy
        )
      `;

      const logResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('pauseReason', sql.NVarChar(500), reason)
        .input('pausedBy', sql.UniqueIdentifier, pausedBy)
        .query(logQuery);

      return logResult.recordset[0];
    } catch (error) {
      console.error('Error pausing SLA timer:', error);
      throw error;
    }
  }

  /**
   * Resume SLA timer
   */
  static async resumeTimer(ticketId, resumedBy) {
    try {
      const pool = await connectDB();

      // Get tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        throw new Error('SLA tracking not found for ticket');
      }

      if (!tracking.is_paused) {
        throw new Error('SLA timer is not paused');
      }

      const now = new Date();
      const pauseStart = new Date(tracking.pause_started_at);
      const pausedMinutes = Math.round((now - pauseStart) / (1000 * 60));

      // Update tracking to resumed and clear any resolution data (for reopened tickets)
      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('totalPausedMinutes', sql.Int, tracking.total_paused_minutes + pausedMinutes)
        .query(`
          UPDATE TICKET_SLA_TRACKING SET
            is_paused = 0,
            pause_started_at = NULL,
            current_pause_reason = NULL,
            total_paused_minutes = @totalPausedMinutes,
            resolved_at = NULL,
            final_status = NULL,
            updated_at = GETUTCDATE()
          WHERE tracking_id = @trackingId
        `);

      // Create resume log entry
      const logQuery = `
        INSERT INTO TICKET_SLA_PAUSE_LOG (
          log_id, tracking_id, action, reason, action_at, paused_duration_minutes, created_by
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @trackingId, 'resumed', 'Timer resumed', GETUTCDATE(), @pausedMinutes, @resumedBy
        )
      `;

      const logResult = await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('pausedMinutes', sql.Int, pausedMinutes)
        .input('resumedBy', sql.UniqueIdentifier, resumedBy)
        .query(logQuery);

      return logResult.recordset[0];
    } catch (error) {
      console.error('Error resuming SLA timer:', error);
      throw error;
    }
  }

  /**
   * Stop SLA tracking (ticket closed)
   */
  // static async stopTracking(ticketId, finalStatus) {
  //   try {
  //     const pool = await connectDB();

  //     // First update elapsed time
  //     await this.updateElapsedTime(ticketId);

  //     // Get tracking record
  //     const tracking = await this.getTracking(ticketId);
  //     if (!tracking) {
  //       return null;
  //     }

  //     // If paused, close the pause first
  //     if (tracking.is_paused) {
  //       await this.resumeTimer(ticketId, null);
  //     }

  //     // Stop tracking
  //     const query = `
  //       UPDATE TICKET_SLA_TRACKING SET
  //         resolved_at = GETUTCDATE(),
  //         final_status = @finalStatus,
  //         updated_at = GETUTCDATE()
  //       OUTPUT INSERTED.*
  //       WHERE tracking_id = @trackingId
  //     `;

  //     const result = await pool.request()
  //       .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
  //       .input('finalStatus', sql.NVarChar(20), finalStatus || tracking.sla_status)
  //       .query(query);

  //     return result.recordset[0];
  //   } catch (error) {
  //     console.error('Error stopping SLA tracking:', error);
  //     throw error;
  //   }
  // }

  static async stopTracking(ticketId, finalStatus) {
  try {
    const pool = await connectDB();

    // Get the actual ticket resolution time
    const ticketResult = await pool.request()
      .input('ticketId', sql.UniqueIdentifier, ticketId)
      .query(`
        SELECT
          resolved_at,
          status
        FROM TICKETS
        WHERE ticket_id = @ticketId
      `);

    if (ticketResult.recordset.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = ticketResult.recordset[0];

    if (!ticket.resolved_at) {
      throw new Error(
        'Ticket resolved_at is NULL. SLA tracking cannot be stopped yet.'
      );
    }

    // First calculate elapsed time using the actual ticket resolution time
    const trackingResult = await pool.request()
      .input('ticketId', sql.UniqueIdentifier, ticketId)
      .query(`
        SELECT
          tst.*,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          sr.business_hours_schedule_id,
          sr.holiday_calendar_id
        FROM TICKET_SLA_TRACKING tst
        INNER JOIN SLA_RULES sr
          ON tst.sla_rule_id = sr.rule_id
        WHERE tst.ticket_id = @ticketId
      `);

    if (trackingResult.recordset.length === 0) {
      return null;
    }

    const tracking = trackingResult.recordset[0];

    // If paused, close the pause first
    if (tracking.is_paused) {
      await this.resumeTimer(ticketId, null);
    }

    // Get pause periods
    const pauseResult = await pool.request()
      .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
      .query(`
        SELECT
          p.action_at AS pause_start,
          r.action_at AS pause_end
        FROM TICKET_SLA_PAUSE_LOG p
        LEFT JOIN TICKET_SLA_PAUSE_LOG r
          ON p.tracking_id = r.tracking_id
          AND r.action = 'resumed'
          AND r.action_at > p.action_at
          AND NOT EXISTS (
            SELECT 1
            FROM TICKET_SLA_PAUSE_LOG p2
            WHERE p2.tracking_id = p.tracking_id
              AND p2.action = 'paused'
              AND p2.action_at > p.action_at
              AND p2.action_at < r.action_at
          )
        WHERE p.tracking_id = @trackingId
          AND p.action = 'paused'
          AND r.action_at IS NOT NULL
      `);

    const pausePeriods = pauseResult.recordset;

    // Calculate elapsed business minutes until ACTUAL ticket resolved_at
    const elapsedMinutes =
      await businessHoursCalculator.calculateElapsedMinutes(
        new Date(tracking.sla_start_time),
        new Date(ticket.resolved_at),
        tracking.business_hours_schedule_id,
        tracking.holiday_calendar_id,
        pausePeriods
      );

    // Calculate final SLA status
    const slaStatus = businessHoursCalculator.calculateSlaStatus(
      elapsedMinutes,
      tracking.min_tat_minutes,
      tracking.avg_tat_minutes,
      tracking.max_tat_minutes
    );

    // Update SLA tracking
    const query = `
      UPDATE TICKET_SLA_TRACKING
      SET
        business_elapsed_minutes = @elapsedMinutes,
        sla_status = @slaStatus,
        resolved_at = @resolvedAt,
        final_status = @finalStatus,
        last_calculated_at = GETUTCDATE(),
        updated_at = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE tracking_id = @trackingId
    `;

    const result = await pool.request()
      .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
      .input('elapsedMinutes', sql.Int, elapsedMinutes)
      .input('slaStatus', sql.NVarChar(20), slaStatus.status)
      .input('resolvedAt', sql.DateTime, new Date(ticket.resolved_at))
      .input(
        'finalStatus',
        sql.NVarChar(20),
        finalStatus || slaStatus.status
      )
      .query(query);

    return result.recordset[0];

  } catch (error) {
    console.error('Error stopping SLA tracking:', error);
    throw error;
  }
}

  /**
   * Get pause history for a ticket
   */
  static async getPauseHistory(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          pl.*,
          u.first_name + ' ' + u.last_name AS action_by_name
        FROM TICKET_SLA_PAUSE_LOG pl
        INNER JOIN TICKET_SLA_TRACKING tst ON pl.tracking_id = tst.tracking_id
        LEFT JOIN USER_MASTER u ON pl.created_by = u.user_id
        WHERE tst.ticket_id = @ticketId
        ORDER BY pl.action_at DESC
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error getting pause history:', error);
      throw error;
    }
  }

  /**
   * Get tickets approaching SLA breach
   */
  static async getTicketsApproachingBreach(thresholdMinutes = 30) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          tst.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.priority,
          t.status,
          t.assigned_to_engineer_id,
          sr.rule_name,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          sr.max_tat_minutes - tst.business_elapsed_minutes AS remaining_minutes,
          CASE WHEN sr.max_tat_minutes > 0
            THEN CAST(tst.business_elapsed_minutes * 100.0 / sr.max_tat_minutes AS INT)
            ELSE 0 END AS percent_used,
          u.first_name + ' ' + u.last_name AS assigned_to_name,
          u.email AS assigned_engineer_email
        FROM TICKET_SLA_TRACKING tst
        INNER JOIN TICKETS t ON tst.ticket_id = t.ticket_id
        INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        WHERE tst.resolved_at IS NULL
          AND tst.is_paused = 0
          AND t.status NOT IN ('closed', 'cancelled')
          AND (sr.max_tat_minutes - tst.business_elapsed_minutes) <= @thresholdMinutes
          AND (sr.max_tat_minutes - tst.business_elapsed_minutes) > 0
        ORDER BY (sr.max_tat_minutes - tst.business_elapsed_minutes) ASC
      `;

      const result = await pool.request()
        .input('thresholdMinutes', sql.Int, thresholdMinutes)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error getting tickets approaching breach:', error);
      throw error;
    }
  }

  /**
   * Get breached tickets
   */
  static async getBreachedTickets() {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          tst.*,
          t.ticket_number,
          t.title AS ticket_title,
          t.priority,
          t.status,
          t.assigned_to_engineer_id,
          sr.rule_name,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes,
          tst.business_elapsed_minutes - sr.max_tat_minutes AS overdue_minutes,
          tst.breach_triggered_at AS breached_at,
          ISNULL((SELECT MAX(escalation_level) FROM ESCALATION_NOTIFICATIONS_LOG el WHERE el.tracking_id = tst.tracking_id), 0) AS escalation_level,
          u.first_name + ' ' + u.last_name AS assigned_to_name,
          u.email AS assigned_engineer_email
        FROM TICKET_SLA_TRACKING tst
        INNER JOIN TICKETS t ON tst.ticket_id = t.ticket_id
        INNER JOIN SLA_RULES sr ON tst.sla_rule_id = sr.rule_id
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        WHERE tst.resolved_at IS NULL
          AND t.status NOT IN ('closed', 'cancelled')
          AND tst.business_elapsed_minutes >= sr.max_tat_minutes
        ORDER BY (tst.business_elapsed_minutes - sr.max_tat_minutes) DESC
      `;

      const result = await pool.request().query(query);
      return result.recordset;
    } catch (error) {
      console.error('Error getting breached tickets:', error);
      throw error;
    }
  }

  /**
   * Get SLA metrics/statistics
   */
  static async getSlaMetrics(filters = {}) {
    try {
      const pool = await connectDB();

      let whereClause = 'WHERE 1=1';
      if (filters.startDate) {
        whereClause += ` AND tst.sla_start_time >= '${filters.startDate}'`;
      }
      if (filters.endDate) {
        whereClause += ` AND tst.sla_start_time <= '${filters.endDate}'`;
      }
      if (filters.ruleId) {
        whereClause += ` AND tst.sla_rule_id = '${filters.ruleId}'`;
      }

      const query = `
        SELECT
          COUNT(*) AS total_tickets,
          SUM(CASE WHEN tst.sla_status = 'on_track' THEN 1 ELSE 0 END) AS on_track_count,
          SUM(CASE WHEN tst.sla_status = 'warning' THEN 1 ELSE 0 END) AS warning_count,
          SUM(CASE WHEN tst.sla_status = 'critical' THEN 1 ELSE 0 END) AS critical_count,
          SUM(CASE WHEN tst.sla_status = 'breached' THEN 1 ELSE 0 END) AS breached_count,
          SUM(CASE WHEN tst.is_paused = 1 THEN 1 ELSE 0 END) AS paused_count,
          SUM(CASE WHEN tst.resolved_at IS NOT NULL AND tst.final_status != 'breached' THEN 1 ELSE 0 END) AS resolved_within_sla,
          AVG(tst.business_elapsed_minutes) AS avg_resolution_minutes,
          AVG(tst.total_paused_minutes) AS avg_paused_minutes,
          CAST(SUM(CASE WHEN tst.resolved_at IS NOT NULL AND tst.final_status != 'breached' THEN 1.0 ELSE 0 END) * 100.0 /
            NULLIF(SUM(CASE WHEN tst.resolved_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS DECIMAL(5,2)) AS sla_compliance_rate
        FROM TICKET_SLA_TRACKING tst
        ${whereClause}
      `;

      const result = await pool.request().query(query);
      return result.recordset[0];
    } catch (error) {
      console.error('Error getting SLA metrics:', error);
      throw error;
    }
  }

  /**
   * Update all active SLA tracking records (for background job)
   */
  static async updateAllActiveTracking() {
    try {
      const pool = await connectDB();

      // Get all active tracking records
      const result = await pool.request()
        .query(`
          SELECT ticket_id FROM TICKET_SLA_TRACKING
          WHERE resolved_at IS NULL AND is_paused = 0
        `);

      const updates = [];
      for (const record of result.recordset) {
        try {
          const updated = await this.updateElapsedTime(record.ticket_id);
          updates.push({ ticket_id: record.ticket_id, status: 'updated', sla_status: updated.sla_status });
        } catch (err) {
          updates.push({ ticket_id: record.ticket_id, status: 'error', error: err.message });
        }
      }

      return updates;
    } catch (error) {
      console.error('Error updating all active tracking:', error);
      throw error;
    }
  }

  /**
   * Get SLA Compliance Report
   * Calculates: (Tickets Resolved Within SLA) / (Total Tickets Due Within SLA)
   * @param {Object} filters - Filter options
   * @param {string} filters.date_from - Start date (required)
   * @param {string} filters.date_to - End date (required)
   * @param {string} filters.location_id - Filter by location
   * @param {string} filters.department_id - Filter by department
   * @param {string} filters.asset_category_id - Filter by asset category
   * @param {string} filters.oem_id - Filter by OEM
   * @param {string} filters.product_model - Filter by product model
   * @param {string} filters.frequency - Group by: daily, weekly, monthly, quarterly
   */
  static async getSlaComplianceReport(filters = {}) {
    try {
      const pool = await connectDB();
      const request = pool.request();

      // Build WHERE clause
      let whereConditions = ['tst.resolved_at IS NOT NULL'];

      // Pre-calculate dates for consistent use across all queries
      const startDate = filters.date_from ? new Date(filters.date_from) : null;
      let endDate = null;
      if (filters.date_to) {
        // Set to end of day (23:59:59) to include all tickets on that day
        endDate = new Date(filters.date_to);
        endDate.setHours(23, 59, 59, 999);
      }

      if (startDate) {
        whereConditions.push('tst.resolved_at >= @dateFrom');
        request.input('dateFrom', sql.DateTime, startDate);
      }

      if (endDate) {
        whereConditions.push('tst.resolved_at <= @dateTo');
        request.input('dateTo', sql.DateTime, endDate);
      }

      if (filters.location_id) {
        whereConditions.push('t.location_id = @locationId');
        request.input('locationId', sql.UniqueIdentifier, filters.location_id);
      }

      if (filters.department_id) {
        whereConditions.push('t.department_id = @departmentId');
        request.input('departmentId', sql.UniqueIdentifier, filters.department_id);
      }

      if (filters.asset_category_id) {
        whereConditions.push('p.category_id = @assetCategoryId');
        request.input('assetCategoryId', sql.UniqueIdentifier, filters.asset_category_id);
      }

      if (filters.sub_category_id) {
            whereConditions.push('p.sub_category_id = @subCategoryId');
        
            request.input(
                'subCategoryId',
                sql.UniqueIdentifier,
                filters.sub_category_id
            );
        }

      if (
            filters.met_sla !== undefined &&
            filters.met_sla !== null &&
            filters.met_sla !== ''
        ) {
            if (String(filters.met_sla) === '1') {
                whereConditions.push(`
                    tst.final_status <> 'breached'
                `);
            } else if (String(filters.met_sla) === '0') {
                whereConditions.push(`
                    tst.final_status = 'breached'
                `);
            }
        }

      if (filters.oem_id) {
        whereConditions.push('p.oem_id = @oemId');
        request.input('oemId', sql.UniqueIdentifier, filters.oem_id);
      }

      if (filters.product_model) {
            whereConditions.push('p.id = @productModel');
        
            request.input(
                'productModel',
                sql.UniqueIdentifier,
                filters.product_model
            );
        }

      const whereClause = whereConditions.length > 0
        ? 'WHERE ' + whereConditions.join(' AND ')
        : '';

      // Determine grouping based on frequency
      let groupByClause = '';
      let periodSelect = '';

      switch (filters.frequency) {
        case 'daily':
          periodSelect = "CONVERT(VARCHAR(10), tst.resolved_at, 120) AS period";
          groupByClause = "GROUP BY CONVERT(VARCHAR(10), tst.resolved_at, 120)";
          break;
        case 'weekly':
          periodSelect = "CONCAT(YEAR(tst.resolved_at), '-W', RIGHT('0' + CAST(DATEPART(WEEK, tst.resolved_at) AS VARCHAR), 2)) AS period";
          groupByClause = "GROUP BY YEAR(tst.resolved_at), DATEPART(WEEK, tst.resolved_at)";
          break;
        case 'monthly':
          periodSelect = "CONCAT(YEAR(tst.resolved_at), '-', RIGHT('0' + CAST(MONTH(tst.resolved_at) AS VARCHAR), 2)) AS period";
          groupByClause = "GROUP BY YEAR(tst.resolved_at), MONTH(tst.resolved_at)";
          break;
        case 'quarterly':
          periodSelect = "CONCAT(YEAR(tst.resolved_at), '-Q', DATEPART(QUARTER, tst.resolved_at)) AS period";
          groupByClause = "GROUP BY YEAR(tst.resolved_at), DATEPART(QUARTER, tst.resolved_at)";
          break;
        default:
          periodSelect = "'Total' AS period";
          groupByClause = "";
      }

      // Main compliance query with period breakdown
      const complianceQuery = `
    SELECT
        ${periodSelect},

        COUNT(DISTINCT t.ticket_id) AS total_resolved,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status != 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_within_sla,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status = 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_breached,

        CAST(
            COUNT(
                DISTINCT CASE
                    WHEN tst.final_status != 'breached'
                    THEN t.ticket_id
                END
            ) * 100.0
            / NULLIF(COUNT(DISTINCT t.ticket_id), 0)
            AS DECIMAL(5,2)
        ) AS compliance_rate,

        AVG(tst.business_elapsed_minutes) AS avg_resolution_minutes,

        MIN(tst.business_elapsed_minutes) AS min_resolution_minutes,

        MAX(tst.business_elapsed_minutes) AS max_resolution_minutes

    FROM TICKET_SLA_TRACKING tst

    INNER JOIN TICKETS t
        ON tst.ticket_id = t.ticket_id

    LEFT JOIN TICKET_ASSETS ta
        ON t.ticket_id = ta.ticket_id

    LEFT JOIN assets a
        ON ta.asset_id = a.id

    LEFT JOIN products p
        ON a.product_id = p.id

    ${whereClause}

    ${groupByClause}

    ORDER BY period
`;

      const complianceResult = await request.query(complianceQuery);

      // Get summary totals
      // const summaryRequest = pool.request();
      // if (startDate) summaryRequest.input('dateFrom', sql.DateTime, startDate);
      // if (endDate) summaryRequest.input('dateTo', sql.DateTime, endDate);
      // if (filters.location_id) summaryRequest.input('locationId', sql.UniqueIdentifier, filters.location_id);
      // if (filters.department_id) summaryRequest.input('departmentId', sql.UniqueIdentifier, filters.department_id);
      // if (filters.asset_category_id) summaryRequest.input('assetCategoryId', sql.UniqueIdentifier, filters.asset_category_id);
      // if (filters.oem_id) summaryRequest.input('oemId', sql.UniqueIdentifier, filters.oem_id);
      // if (filters.product_model) summaryRequest.input('productModel', sql.NVarChar, `%${filters.product_model}%`);

      const summaryRequest = pool.request();

        if (startDate) {
          summaryRequest.input('dateFrom', sql.DateTime, startDate);
        }
        
        if (endDate) {
          summaryRequest.input('dateTo', sql.DateTime, endDate);
        }
        
        if (filters.location_id) {
          summaryRequest.input(
            'locationId',
            sql.UniqueIdentifier,
            filters.location_id
          );
        }
        
        if (filters.department_id) {
          summaryRequest.input(
            'departmentId',
            sql.UniqueIdentifier,
            filters.department_id
          );
        }
        
        if (filters.asset_category_id) {
          summaryRequest.input(
            'assetCategoryId',
            sql.UniqueIdentifier,
            filters.asset_category_id
          );
        }
        
        if (filters.sub_category_id) {
          summaryRequest.input(
            'subCategoryId',
            sql.UniqueIdentifier,
            filters.sub_category_id
          );
        }
        
        if (filters.oem_id) {
          summaryRequest.input(
            'oemId',
            sql.UniqueIdentifier,
            filters.oem_id
          );
        }
        
        if (filters.product_model) {
          summaryRequest.input(
            'productModel',
            sql.UniqueIdentifier,
            filters.product_model
          );
        }

      const summaryQuery = `
    SELECT
        COUNT(DISTINCT t.ticket_id) AS total_resolved,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status != 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_within_sla,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status = 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_breached,

        CAST(
            COUNT(
                DISTINCT CASE
                    WHEN tst.final_status != 'breached'
                    THEN t.ticket_id
                END
            ) * 100.0
            / NULLIF(COUNT(DISTINCT t.ticket_id), 0)
            AS DECIMAL(5,2)
        ) AS compliance_rate,

        AVG(tst.business_elapsed_minutes) AS avg_resolution_minutes

    FROM TICKET_SLA_TRACKING tst
    INNER JOIN TICKETS t
        ON tst.ticket_id = t.ticket_id

    LEFT JOIN TICKET_ASSETS ta
        ON t.ticket_id = ta.ticket_id

    LEFT JOIN assets a
        ON ta.asset_id = a.id

    LEFT JOIN products p
        ON a.product_id = p.id

    ${whereClause}
`;

      const summaryResult = await summaryRequest.query(summaryQuery);

      // Get breakdown by location
      // const locationRequest = pool.request();
      // if (startDate) locationRequest.input('dateFrom', sql.DateTime, startDate);
      // if (endDate) locationRequest.input('dateTo', sql.DateTime, endDate);
      // if (filters.location_id) locationRequest.input('locationId', sql.UniqueIdentifier, filters.location_id);
      // if (filters.department_id) locationRequest.input('departmentId', sql.UniqueIdentifier, filters.department_id);
      // if (filters.asset_category_id) locationRequest.input('assetCategoryId', sql.UniqueIdentifier, filters.asset_category_id);
      // if (filters.oem_id) locationRequest.input('oemId', sql.UniqueIdentifier, filters.oem_id);
      // if (filters.product_model) locationRequest.input('productModel', sql.NVarChar, `%${filters.product_model}%`);

      const locationRequest = pool.request();

      if (startDate) {
        locationRequest.input('dateFrom', sql.DateTime, startDate);
      }
      
      if (endDate) {
        locationRequest.input('dateTo', sql.DateTime, endDate);
      }
      
      if (filters.location_id) {
        locationRequest.input(
          'locationId',
          sql.UniqueIdentifier,
          filters.location_id
        );
      }
      
      if (filters.department_id) {
        locationRequest.input(
          'departmentId',
          sql.UniqueIdentifier,
          filters.department_id
        );
      }
      
      if (filters.asset_category_id) {
        locationRequest.input(
          'assetCategoryId',
          sql.UniqueIdentifier,
          filters.asset_category_id
        );
      }
      
      if (filters.sub_category_id) {
        locationRequest.input(
          'subCategoryId',
          sql.UniqueIdentifier,
          filters.sub_category_id
        );
      }
      
      if (filters.oem_id) {
        locationRequest.input(
          'oemId',
          sql.UniqueIdentifier,
          filters.oem_id
        );
      }
      
      if (filters.product_model) {
        locationRequest.input(
          'productModel',
          sql.UniqueIdentifier,
          filters.product_model
        );
      }

      const locationBreakdownQuery = `
    SELECT
        l.id AS location_id,
        l.name AS location_name,

        COUNT(DISTINCT t.ticket_id) AS total_resolved,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status != 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_within_sla,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status = 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_breached,

        CAST(
            COUNT(
                DISTINCT CASE
                    WHEN tst.final_status != 'breached'
                    THEN t.ticket_id
                END
            ) * 100.0
            / NULLIF(COUNT(DISTINCT t.ticket_id), 0)
            AS DECIMAL(5,2)
        ) AS compliance_rate

    FROM TICKET_SLA_TRACKING tst

    INNER JOIN TICKETS t
        ON tst.ticket_id = t.ticket_id

    LEFT JOIN locations l
        ON t.location_id = l.id

    LEFT JOIN TICKET_ASSETS ta
        ON t.ticket_id = ta.ticket_id

    LEFT JOIN assets a
        ON ta.asset_id = a.id

    LEFT JOIN products p
        ON a.product_id = p.id

    ${whereClause}

    GROUP BY
        l.id,
        l.name

    ORDER BY total_resolved DESC
`;

      const locationBreakdown = await locationRequest.query(locationBreakdownQuery);

      // Get breakdown by department
      // const deptRequest = pool.request();
      // if (startDate) deptRequest.input('dateFrom', sql.DateTime, startDate);
      // if (endDate) deptRequest.input('dateTo', sql.DateTime, endDate);
      // if (filters.location_id) deptRequest.input('locationId', sql.UniqueIdentifier, filters.location_id);
      // if (filters.department_id) deptRequest.input('departmentId', sql.UniqueIdentifier, filters.department_id);
      // if (filters.asset_category_id) deptRequest.input('assetCategoryId', sql.UniqueIdentifier, filters.asset_category_id);
      // if (filters.oem_id) deptRequest.input('oemId', sql.UniqueIdentifier, filters.oem_id);
      // if (filters.product_model) deptRequest.input('productModel', sql.NVarChar, `%${filters.product_model}%`);

      const deptRequest = pool.request();

      if (startDate) {
        deptRequest.input('dateFrom', sql.DateTime, startDate);
      }
      
      if (endDate) {
        deptRequest.input('dateTo', sql.DateTime, endDate);
      }
      
      if (filters.location_id) {
        deptRequest.input(
          'locationId',
          sql.UniqueIdentifier,
          filters.location_id
        );
      }
      
      if (filters.department_id) {
        deptRequest.input(
          'departmentId',
          sql.UniqueIdentifier,
          filters.department_id
        );
      }
      
      if (filters.asset_category_id) {
        deptRequest.input(
          'assetCategoryId',
          sql.UniqueIdentifier,
          filters.asset_category_id
        );
      }
      
      if (filters.sub_category_id) {
        deptRequest.input(
          'subCategoryId',
          sql.UniqueIdentifier,
          filters.sub_category_id
        );
      }
      
      if (filters.oem_id) {
        deptRequest.input(
          'oemId',
          sql.UniqueIdentifier,
          filters.oem_id
        );
      }
      
      if (filters.product_model) {
        deptRequest.input(
          'productModel',
          sql.UniqueIdentifier,
          filters.product_model
        );
      }

      const deptBreakdownQuery = `
    SELECT
        d.department_id,
        d.department_name,

        COUNT(DISTINCT t.ticket_id) AS total_resolved,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status != 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_within_sla,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status = 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_breached,

        CAST(
            COUNT(
                DISTINCT CASE
                    WHEN tst.final_status != 'breached'
                    THEN t.ticket_id
                END
            ) * 100.0
            / NULLIF(COUNT(DISTINCT t.ticket_id), 0)
            AS DECIMAL(5,2)
        ) AS compliance_rate

    FROM TICKET_SLA_TRACKING tst

    INNER JOIN TICKETS t
        ON tst.ticket_id = t.ticket_id

    LEFT JOIN DEPARTMENT_MASTER d
        ON t.department_id = d.department_id

    LEFT JOIN TICKET_ASSETS ta
        ON t.ticket_id = ta.ticket_id

    LEFT JOIN assets a
        ON ta.asset_id = a.id

    LEFT JOIN products p
        ON a.product_id = p.id

    ${whereClause}

    GROUP BY
        d.department_id,
        d.department_name

    ORDER BY total_resolved DESC
`;

      const deptBreakdown = await deptRequest.query(deptBreakdownQuery);

      // ==================== SUB CATEGORY BREAKDOWN ====================

const subCategoryRequest = pool.request();

if (startDate) {
  subCategoryRequest.input(
    'dateFrom',
    sql.DateTime,
    startDate
  );
}

if (endDate) {
  subCategoryRequest.input(
    'dateTo',
    sql.DateTime,
    endDate
  );
}

if (filters.location_id) {
  subCategoryRequest.input(
    'locationId',
    sql.UniqueIdentifier,
    filters.location_id
  );
}

if (filters.department_id) {
  subCategoryRequest.input(
    'departmentId',
    sql.UniqueIdentifier,
    filters.department_id
  );
}

if (filters.asset_category_id) {
  subCategoryRequest.input(
    'assetCategoryId',
    sql.UniqueIdentifier,
    filters.asset_category_id
  );
}

if (filters.sub_category_id) {
  subCategoryRequest.input(
    'subCategoryId',
    sql.UniqueIdentifier,
    filters.sub_category_id
  );
}

if (filters.oem_id) {
  subCategoryRequest.input(
    'oemId',
    sql.UniqueIdentifier,
    filters.oem_id
  );
}

if (filters.product_model) {
  subCategoryRequest.input(
    'productModel',
    sql.UniqueIdentifier,
    filters.product_model
  );
}

const subCategoryBreakdownQuery = `
    SELECT
        sc.id AS sub_category_id,
        sc.name AS sub_category_name,

        COUNT(DISTINCT t.ticket_id) AS total_resolved,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status != 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_within_sla,

        COUNT(
            DISTINCT CASE
                WHEN tst.final_status = 'breached'
                THEN t.ticket_id
            END
        ) AS resolved_breached,

        CAST(
            COUNT(
                DISTINCT CASE
                    WHEN tst.final_status != 'breached'
                    THEN t.ticket_id
                END
            ) * 100.0
            / NULLIF(COUNT(DISTINCT t.ticket_id), 0)
            AS DECIMAL(5,2)
        ) AS compliance_rate

    FROM TICKET_SLA_TRACKING tst

    INNER JOIN TICKETS t
        ON tst.ticket_id = t.ticket_id

    LEFT JOIN TICKET_ASSETS ta
        ON t.ticket_id = ta.ticket_id

    LEFT JOIN assets a
        ON ta.asset_id = a.id

    LEFT JOIN products p
        ON a.product_id = p.id

    INNER JOIN categories sc
        ON p.sub_category_id = sc.id

    ${whereClause}

    GROUP BY
        sc.id,
        sc.name

    ORDER BY total_resolved DESC
`;

const subCategoryBreakdown =
  await subCategoryRequest.query(
    subCategoryBreakdownQuery
  );
      

      // Get detailed ticket list
      // const detailRequest = pool.request();
      // if (startDate) detailRequest.input('dateFrom', sql.DateTime, startDate);
      // if (endDate) detailRequest.input('dateTo', sql.DateTime, endDate);
      // if (filters.location_id) detailRequest.input('locationId', sql.UniqueIdentifier, filters.location_id);
      // if (filters.department_id) detailRequest.input('departmentId', sql.UniqueIdentifier, filters.department_id);
      // if (filters.asset_category_id) detailRequest.input('assetCategoryId', sql.UniqueIdentifier, filters.asset_category_id);
      // if (filters.oem_id) detailRequest.input('oemId', sql.UniqueIdentifier, filters.oem_id);
      // if (filters.product_model) detailRequest.input('productModel', sql.NVarChar, `%${filters.product_model}%`);

      const detailRequest = pool.request();

if (startDate) {
  detailRequest.input('dateFrom', sql.DateTime, startDate);
}

if (endDate) {
  detailRequest.input('dateTo', sql.DateTime, endDate);
}

if (filters.location_id) {
  detailRequest.input(
    'locationId',
    sql.UniqueIdentifier,
    filters.location_id
  );
}

if (filters.department_id) {
  detailRequest.input(
    'departmentId',
    sql.UniqueIdentifier,
    filters.department_id
  );
}

if (filters.asset_category_id) {
  detailRequest.input(
    'assetCategoryId',
    sql.UniqueIdentifier,
    filters.asset_category_id
  );
}

if (filters.sub_category_id) {
  detailRequest.input(
    'subCategoryId',
    sql.UniqueIdentifier,
    filters.sub_category_id
  );
}

if (filters.oem_id) {
  detailRequest.input(
    'oemId',
    sql.UniqueIdentifier,
    filters.oem_id
  );
}

if (filters.product_model) {
  detailRequest.input(
    'productModel',
    sql.UniqueIdentifier,
    filters.product_model
  );
}

     const detailQuery = `
    SELECT DISTINCT
        t.ticket_id,
        t.ticket_number,
        t.title,
        t.category,
        sc.name AS sub_category_name,
        t.priority,
        t.status,

        tst.sla_start_time,
        tst.resolved_at,
        tst.final_status,
        tst.business_elapsed_minutes,

        sr.rule_name,
        sr.max_tat_minutes,

        CASE
            WHEN tst.final_status != 'breached'
            THEN 1
            ELSE 0
        END AS met_sla,

        l.name AS location_name,
        d.department_name,

        u.first_name + ' ' + u.last_name AS engineer_name

    FROM TICKET_SLA_TRACKING tst

    INNER JOIN TICKETS t
        ON tst.ticket_id = t.ticket_id

    INNER JOIN SLA_RULES sr
        ON tst.sla_rule_id = sr.rule_id

    LEFT JOIN locations l
        ON t.location_id = l.id

    LEFT JOIN DEPARTMENT_MASTER d
        ON t.department_id = d.department_id

    LEFT JOIN USER_MASTER u
        ON t.assigned_to_engineer_id = u.user_id

    LEFT JOIN TICKET_ASSETS ta
        ON t.ticket_id = ta.ticket_id

    LEFT JOIN assets a
        ON ta.asset_id = a.id

    LEFT JOIN products p
        ON a.product_id = p.id

    LEFT JOIN categories sc
    ON p.sub_category_id = sc.id

    ${whereClause}

    ORDER BY tst.resolved_at DESC
`;

      const detailResult = await detailRequest.query(detailQuery);

      // return {
      //   summary: summaryResult.recordset[0] || {
      //     total_resolved: 0,
      //     resolved_within_sla: 0,
      //     resolved_breached: 0,
      //     compliance_rate: null,
      //     avg_resolution_minutes: 0
      //   },
      //   by_period: complianceResult.recordset,
      //   by_location: locationBreakdown.recordset,
      //   by_department: deptBreakdown.recordset,
      //   details: detailResult.recordset,
      //   filters_applied: filters
      // };

      return {
    summary: summaryResult.recordset[0] || {
        total_resolved: 0,
        resolved_within_sla: 0,
        resolved_breached: 0,
        compliance_rate: null,
        avg_resolution_minutes: 0
    },

    by_period: complianceResult.recordset,

    by_location: locationBreakdown.recordset,

    by_department: deptBreakdown.recordset,

    by_sub_category: subCategoryBreakdown.recordset,

    details: detailResult.recordset,

    filters_applied: filters
};
    } catch (error) {
      console.error('Error getting SLA compliance report:', error);
      throw error;
    }
  }

  /**
   * Recalculate SLA targets when ticket priority changes
   * Keeps elapsed time, recalculates targets based on new priority
   * @param {string} ticketId - Ticket ID
   * @param {Object} newTicketContext - Updated ticket context with new priority
   * @param {string} changedBy - User ID who made the change
   * @returns {Object} Updated tracking info
   */
  static async recalculateSlaOnPriorityChange(ticketId, newTicketContext, changedBy) {
    try {
      const pool = await connectDB();

      // Get existing tracking record
      const tracking = await this.getTracking(ticketId);
      if (!tracking) {
        console.log(`No SLA tracking found for ticket ${ticketId}, skipping recalculation`);
        return null;
      }

      // If ticket is resolved, don't recalculate
      if (tracking.resolved_at) {
        console.log(`Ticket ${ticketId} is already resolved, skipping SLA recalculation`);
        return tracking;
      }

      // Store previous values for logging
      const previousRuleId = tracking.sla_rule_id;
      const previousRuleName = tracking.rule_name;
      const previousMinTarget = tracking.min_target_time;
      const previousAvgTarget = tracking.avg_target_time;
      const previousMaxTarget = tracking.max_target_time;

      // Find new matching SLA rule based on new priority
      const matchResult = await slaMatchingEngine.findMatchingRule(newTicketContext);
      const newRule = matchResult.rule;

      // If the same rule matches, no recalculation needed
      if (newRule.rule_id === previousRuleId) {
        console.log(`Same SLA rule applies after priority change for ticket ${ticketId}`);
        return tracking;
      }

      // Calculate new deadlines from the ORIGINAL sla_start_time (preserving elapsed time)
      const originalStartTime = new Date(tracking.sla_start_time);

      const newMinDeadline = await businessHoursCalculator.calculateDeadline(
        originalStartTime,
        newRule.min_tat_minutes,
        newRule.business_hours_schedule_id,
        newRule.holiday_calendar_id
      );
      const newAvgDeadline = await businessHoursCalculator.calculateDeadline(
        originalStartTime,
        newRule.avg_tat_minutes,
        newRule.business_hours_schedule_id,
        newRule.holiday_calendar_id
      );
      const newMaxDeadline = await businessHoursCalculator.calculateDeadline(
        originalStartTime,
        newRule.max_tat_minutes,
        newRule.business_hours_schedule_id,
        newRule.holiday_calendar_id
      );

      // Update tracking record with new rule and targets
      const updateQuery = `
        UPDATE TICKET_SLA_TRACKING SET
          sla_rule_id = @newRuleId,
          min_target_time = @minDeadline,
          avg_target_time = @avgDeadline,
          max_target_time = @maxDeadline,
          updated_at = GETUTCDATE()
        OUTPUT INSERTED.*
        WHERE tracking_id = @trackingId
      `;

      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('newRuleId', sql.UniqueIdentifier, newRule.rule_id)
        .input('minDeadline', sql.DateTime, newMinDeadline)
        .input('avgDeadline', sql.DateTime, newAvgDeadline)
        .input('maxDeadline', sql.DateTime, newMaxDeadline)
        .query(updateQuery);

      // Log the SLA change in pause log (using 'recalculated' action)
      const logQuery = `
        INSERT INTO TICKET_SLA_PAUSE_LOG (
          log_id, tracking_id, action, reason, action_at, created_by
        )
        VALUES (
          NEWID(), @trackingId, 'recalculated',
          @reason, GETUTCDATE(), @changedBy
        )
      `;

      const changeReason = `Priority changed. SLA rule changed from "${previousRuleName}" to "${newRule.rule_name}". New targets: Min=${newRule.min_tat_minutes}min, Avg=${newRule.avg_tat_minutes}min, Max=${newRule.max_tat_minutes}min`;

      await pool.request()
        .input('trackingId', sql.UniqueIdentifier, tracking.tracking_id)
        .input('reason', sql.NVarChar(500), changeReason)
        .input('changedBy', sql.UniqueIdentifier, changedBy)
        .query(logQuery);

      // Update elapsed time with new rule
      const updatedTracking = await this.updateElapsedTime(ticketId);

      console.log(`SLA recalculated for ticket ${ticketId}: Rule changed from "${previousRuleName}" to "${newRule.rule_name}"`);

      return {
        ...updatedTracking,
        sla_recalculated: true,
        previous_rule: previousRuleName,
        new_rule: newRule.rule_name,
        previous_targets: {
          min: previousMinTarget,
          avg: previousAvgTarget,
          max: previousMaxTarget
        },
        new_targets: {
          min: newMinDeadline,
          avg: newAvgDeadline,
          max: newMaxDeadline
        }
      };
    } catch (error) {
      console.error('Error recalculating SLA on priority change:', error);
      throw error;
    }
  }
}

module.exports = SlaTrackingModel;
