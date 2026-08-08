/**
 * SLA CONTROLLER
 * Handles all SLA-related API endpoints
 */

const SlaRulesModel = require('../models/slaRules');
const SlaTrackingModel = require('../models/slaTracking');
const slaMatchingEngine = require('../services/slaMatchingEngine');
const escalationEngine = require('../services/escalationEngine');
const slaNotificationService = require('../services/slaNotificationService');
const businessHoursCalculator = require('../utils/businessHoursCalculator');
const { connectDB } = require('../config/database');

class SlaController {
  // ==================== SLA RULES ====================

  /**
   * Get all SLA rules
   */
  static async getAllRules(req, res) {
    try {
      const { isActive } = req.query;
      const filters = {};

      if (isActive !== undefined) {
        filters.isActive = isActive === 'true';
      }

      const rules = await SlaRulesModel.getAllRules(filters);

      res.json({
        success: true,
        data: { rules }
      });
    } catch (error) {
      console.error('Error getting SLA rules:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get SLA rules',
        error: error.message
      });
    }
  }

  /**
   * Get SLA rule by ID
   */
  static async getRuleById(req, res) {
    try {
      const { ruleId } = req.params;
      const rule = await SlaRulesModel.getRuleById(ruleId);

      if (!rule) {
        return res.status(404).json({
          success: false,
          message: 'SLA rule not found'
        });
      }

      res.json({
        success: true,
        data: { rule }
      });
    } catch (error) {
      console.error('Error getting SLA rule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get SLA rule',
        error: error.message
      });
    }
  }

  /**
   * Create a new SLA rule
   */
  static async createRule(req, res) {
    try {
      const ruleData = {
        ...req.body,
        created_by: req.user.user_id
      };

      const rule = await SlaRulesModel.createRule(ruleData);

      res.status(201).json({
        success: true,
        message: 'SLA rule created successfully',
        data: { rule }
      });
    } catch (error) {
      console.error('Error creating SLA rule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create SLA rule',
        error: error.message
      });
    }
  }

  /**
   * Update an SLA rule
   */
  static async updateRule(req, res) {
    try {
      const { ruleId } = req.params;
      const rule = await SlaRulesModel.updateRule(ruleId, req.body);

      if (!rule) {
        return res.status(404).json({
          success: false,
          message: 'SLA rule not found'
        });
      }

      res.json({
        success: true,
        message: 'SLA rule updated successfully',
        data: { rule }
      });
    } catch (error) {
      console.error('Error updating SLA rule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update SLA rule',
        error: error.message
      });
    }
  }

  /**
   * Delete an SLA rule
   */
  static async deleteRule(req, res) {
    try {
      const { ruleId } = req.params;
      const deleted = await SlaRulesModel.deleteRule(ruleId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'SLA rule not found'
        });
      }

      res.json({
        success: true,
        message: 'SLA rule deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting SLA rule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete SLA rule',
        error: error.message
      });
    }
  }

  // ==================== BUSINESS HOURS ====================

  /**
   * Get all business hours schedules
   */
  static async getBusinessHoursSchedules(req, res) {
    try {
      const schedules = await SlaRulesModel.getBusinessHoursSchedules();

      res.json({
        success: true,
        data: { schedules }
      });
    } catch (error) {
      console.error('Error getting business hours schedules:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get business hours schedules',
        error: error.message
      });
    }
  }

  /**
   * Get business hours schedule details
   */
  static async getBusinessHoursDetails(req, res) {
    try {
      const { scheduleId } = req.params;

      const details = await SlaRulesModel.getBusinessHoursDetails(scheduleId);
      const breaks = await SlaRulesModel.getBreakHours(scheduleId);

      res.json({
        success: true,
        data: { details, breaks }
      });
    } catch (error) {
      console.error('Error getting business hours details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get business hours details',
        error: error.message
      });
    }
  }

  /**
   * Save business hours schedule
   */
  static async saveBusinessHoursSchedule(req, res) {
    try {
      const scheduleId = await SlaRulesModel.saveBusinessHoursSchedule(
        req.body,
        req.user.user_id
      );

      // Clear calculator cache
      businessHoursCalculator.clearCache();

      res.json({
        success: true,
        message: 'Business hours schedule saved successfully',
        data: { schedule_id: scheduleId }
      });
    } catch (error) {
      console.error('Error saving business hours schedule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save business hours schedule',
        error: error.message
      });
    }
  }

  /**
   * Delete business hours schedule
   */
  static async deleteBusinessHoursSchedule(req, res) {
    try {
      const { scheduleId } = req.params;
      const deleted = await SlaRulesModel.deleteBusinessHoursSchedule(scheduleId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Business hours schedule not found'
        });
      }

      // Clear calculator cache
      businessHoursCalculator.clearCache();

      res.json({
        success: true,
        message: 'Business hours schedule deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting business hours schedule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete business hours schedule',
        error: error.message
      });
    }
  }

  // ==================== HOLIDAY CALENDARS ====================

  /**
   * Get all holiday calendars
   */
  static async getHolidayCalendars(req, res) {
    try {
      const calendars = await SlaRulesModel.getHolidayCalendars();

      res.json({
        success: true,
        data: { calendars }
      });
    } catch (error) {
      console.error('Error getting holiday calendars:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get holiday calendars',
        error: error.message
      });
    }
  }

  /**
   * Get holiday dates for a calendar
   */
  static async getHolidayDates(req, res) {
    try {
      const { calendarId } = req.params;
      const dates = await SlaRulesModel.getHolidayDates(calendarId);

      res.json({
        success: true,
        data: { dates }
      });
    } catch (error) {
      console.error('Error getting holiday dates:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get holiday dates',
        error: error.message
      });
    }
  }

  /**
   * Save holiday calendar
   */
  static async saveHolidayCalendar(req, res) {
    try {
      const calendarId = await SlaRulesModel.saveHolidayCalendar(
        req.body,
        req.user.user_id
      );

      // Clear calculator cache
      businessHoursCalculator.clearCache();

      res.json({
        success: true,
        message: 'Holiday calendar saved successfully',
        data: { calendar_id: calendarId }
      });
    } catch (error) {
      console.error('Error saving holiday calendar:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save holiday calendar',
        error: error.message
      });
    }
  }

  /**
   * Delete holiday calendar
   */
  static async deleteHolidayCalendar(req, res) {
    try {
      const { calendarId } = req.params;
      const deleted = await SlaRulesModel.deleteHolidayCalendar(calendarId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Holiday calendar not found'
        });
      }

      // Clear calculator cache
      businessHoursCalculator.clearCache();

      res.json({
        success: true,
        message: 'Holiday calendar deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting holiday calendar:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete holiday calendar',
        error: error.message
      });
    }
  }

  // ==================== ESCALATION RULES ====================

  /**
   * Get escalation rules for an SLA rule
   */
  static async getEscalationRulesForSla(req, res) {
    try {
      const { ruleId } = req.params;
      const rules = await SlaRulesModel.getEscalationRulesForSla(ruleId);

      res.json({
        success: true,
        data: { rules }
      });
    } catch (error) {
      console.error('Error fetching escalation rules:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch escalation rules',
        error: error.message
      });
    }
  }

  /**
   * Save escalation rule
   */
  static async saveEscalationRule(req, res) {
    try {
      const rule = await SlaRulesModel.saveEscalationRule(req.body);

      res.json({
        success: true,
        message: 'Escalation rule saved successfully',
        data: { rule }
      });
    } catch (error) {
      console.error('Error saving escalation rule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save escalation rule',
        error: error.message
      });
    }
  }

  /**
   * Delete escalation rule
   */
  static async deleteEscalationRule(req, res) {
    try {
      const { escalationRuleId } = req.params;
      const deleted = await SlaRulesModel.deleteEscalationRule(escalationRuleId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Escalation rule not found'
        });
      }

      res.json({
        success: true,
        message: 'Escalation rule deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting escalation rule:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete escalation rule',
        error: error.message
      });
    }
  }

  // ==================== SLA TRACKING ====================

  /**
   * Get SLA tracking for a ticket
   */
  static async getTicketSlaTracking(req, res) {
    try {
      const { ticketId } = req.params;

      // First check if tracking exists
      const existingTracking = await SlaTrackingModel.getTracking(ticketId);

      if (!existingTracking) {
        // No SLA tracking for this ticket - this is valid for tickets without linked assets
        return res.json({
          success: true,
          data: {
            tracking: null,
            pause_history: [],
            escalation_history: [],
            message: 'No SLA tracking available for this ticket (no asset linked or SLA rule not applicable)'
          }
        });
      }

      // Update elapsed time
      const tracking = await SlaTrackingModel.updateElapsedTime(ticketId);

      // Get pause history
      const pauseHistory = await SlaTrackingModel.getPauseHistory(ticketId);

      // Get escalation history
      const escalationHistory = await escalationEngine.getTicketEscalationHistory(ticketId);

      res.json({
        success: true,
        data: {
          tracking,
          pause_history: pauseHistory,
          escalation_history: escalationHistory
        }
      });
    } catch (error) {
      console.error('Error getting ticket SLA tracking:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get ticket SLA tracking',
        error: error.message
      });
    }
  }

  /**
   * Pause SLA timer
   */
  static async pauseSlaTimer(req, res) {
    try {
      const { ticketId } = req.params;
      const { reason } = req.body;

      const pauseLog = await SlaTrackingModel.pauseTimer(
        ticketId,
        reason,
        req.user.user_id
      );

      res.json({
        success: true,
        message: 'SLA timer paused successfully',
        data: { pause_log: pauseLog }
      });
    } catch (error) {
      console.error('Error pausing SLA timer:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to pause SLA timer'
      });
    }
  }

  /**
   * Resume SLA timer
   */
  static async resumeSlaTimer(req, res) {
    try {
      const { ticketId } = req.params;

      const pauseLog = await SlaTrackingModel.resumeTimer(
        ticketId,
        req.user.user_id
      );

      res.json({
        success: true,
        message: 'SLA timer resumed successfully',
        data: { pause_log: pauseLog }
      });
    } catch (error) {
      console.error('Error resuming SLA timer:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to resume SLA timer'
      });
    }
  }

  // ==================== SLA DASHBOARD ====================

  /**
   * Get SLA dashboard data
   */
  static async getDashboard(req, res) {
    try {
      const { startDate, endDate } = req.query;

      // Get metrics
      const metrics = await SlaTrackingModel.getSlaMetrics({
        startDate,
        endDate
      });

      // Get tickets approaching breach
      const approachingBreach = await SlaTrackingModel.getTicketsApproachingBreach(60);

      // Get breached tickets
      const breachedTickets = await SlaTrackingModel.getBreachedTickets();

      // Get notification stats
      const notificationStats = await slaNotificationService.getNotificationStats({
        startDate,
        endDate
      });

      res.json({
        success: true,
        data: {
          metrics,
          approaching_breach: approachingBreach,
          breached_tickets: breachedTickets,
          notification_stats: notificationStats
        }
      });
    } catch (error) {
      console.error('Error getting SLA dashboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get SLA dashboard data',
        error: error.message
      });
    }
  }

  /**
   * Get SLA metrics
   */
  static async getMetrics(req, res) {
    try {
      const { startDate, endDate, ruleId } = req.query;

      const metrics = await SlaTrackingModel.getSlaMetrics({
        startDate,
        endDate,
        ruleId
      });

      res.json({
        success: true,
        data: { metrics }
      });
    } catch (error) {
      console.error('Error getting SLA metrics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get SLA metrics',
        error: error.message
      });
    }
  }

  /**
   * Get bulk SLA summary for tickets
   */
  static async getBulkSlaSummary(req, res) {
    try {
      const { ticketIds } = req.body;

      if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'ticketIds array is required'
        });
      }

      const summary = await slaMatchingEngine.getBulkSlaSummary(ticketIds);

      res.json({
        success: true,
        data: { summary }
      });
    } catch (error) {
      console.error('Error getting bulk SLA summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get bulk SLA summary',
        error: error.message
      });
    }
  }

  // ==================== MANUAL TRIGGERS ====================

  /**
   * Manually trigger escalation processing (for testing/admin)
   */
  static async triggerEscalationProcessing(req, res) {
    try {
      // Check admin role
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const results = await escalationEngine.processAllPendingEscalations();

      res.json({
        success: true,
        message: 'Escalation processing completed',
        data: { results }
      });
    } catch (error) {
      console.error('Error triggering escalation processing:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process escalations',
        error: error.message
      });
    }
  }

  /**
   * Manually trigger notification processing (for testing/admin)
   */
  static async triggerNotificationProcessing(req, res) {
    try {
      // Check admin role
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const results = await slaNotificationService.processPendingNotifications();

      res.json({
        success: true,
        message: 'Notification processing completed',
        data: { results }
      });
    } catch (error) {
      console.error('Error triggering notification processing:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process notifications',
        error: error.message
      });
    }
  }

  /**
   * Update all active SLA tracking (for cron job)
   */
  static async updateAllTracking(req, res) {
    try {
      const results = await SlaTrackingModel.updateAllActiveTracking();

      res.json({
        success: true,
        message: 'SLA tracking updated',
        data: {
          updated_count: results.filter(r => r.status === 'updated').length,
          error_count: results.filter(r => r.status === 'error').length,
          results
        }
      });
    } catch (error) {
      console.error('Error updating all tracking:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update SLA tracking',
        error: error.message
      });
    }
  }

  // ==================== LOOKUP DATA ====================

  /**
   * Get available designations for escalation rules
   */
  static async getDesignations(req, res) {
    try {
      const pool = await connectDB();
      const result = await pool.request().query(`
        SELECT DISTINCT designation, COUNT(*) as user_count
        FROM USER_MASTER
        WHERE designation IS NOT NULL
          AND designation != ''
          AND is_active = 1
        GROUP BY designation
        ORDER BY designation
      `);

      res.json({
        success: true,
        data: {
          designations: result.recordset.map(r => ({
            value: r.designation,
            label: r.designation,
            userCount: r.user_count
          }))
        }
      });
    } catch (error) {
      console.error('Error getting designations:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get designations',
        error: error.message
      });
    }
  }

  /**
   * Get available roles for escalation rules
   */
  static async getRoles(req, res) {
    try {
      const pool = await connectDB();
      const result = await pool.request().query(`
        SELECT DISTINCT role, COUNT(*) as user_count
        FROM USER_MASTER
        WHERE role IS NOT NULL
          AND is_active = 1
        GROUP BY role
        ORDER BY role
      `);

      res.json({
        success: true,
        data: {
          roles: result.recordset.map(r => ({
            value: r.role,
            label: r.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            userCount: r.user_count
          }))
        }
      });
    } catch (error) {
      console.error('Error getting roles:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get roles',
        error: error.message
      });
    }
  }

  // ==================== REPORTS ====================

  /**
   * Get SLA Compliance Report
   */
  static async getComplianceReport(req, res) {
    try {
      const {
          date_from,
          date_to,
          location_id,
          department_id,
          asset_category_id,
          sub_category_id,
          oem_id,
          product_model,
          frequency,
          met_sla
        } = req.query;

      // Validate required date range
      if (!date_from || !date_to) {
        return res.status(400).json({
          success: false,
          message: 'date_from and date_to are required parameters'
        });
      }

      const filters = {
            date_from,
            date_to,
            location_id,
            department_id,
            asset_category_id,
            sub_category_id,
            oem_id,
            product_model,
            frequency,
            met_sla
          };

      const report = await SlaTrackingModel.getSlaComplianceReport(filters);

      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('Error getting SLA compliance report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get SLA compliance report',
        error: error.message
      });
    }
  }

  /**
   * Export SLA Compliance Report to Excel
   */
  static async exportComplianceReport(req, res) {
    try {
      const ExcelJS = require('exceljs');
      const {
        date_from,
        date_to,
        location_id,
        department_id,
        asset_category_id,
        sub_category_id,
        oem_id,
        product_model,
        frequency,
        met_sla
      } = req.query;

      // Validate required date range
      if (!date_from || !date_to) {
        return res.status(400).json({
          success: false,
          message: 'date_from and date_to are required parameters'
        });
      }

      const filters = {
      date_from,
      date_to,
      location_id,
      department_id,
      asset_category_id,
      sub_category_id,
      oem_id,
      product_model,
      frequency,
      met_sla
    };

      const report = await SlaTrackingModel.getSlaComplianceReport(filters);

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Unified ITSM Platform';
      workbook.created = new Date();

      // Summary Sheet
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 }
      ];

      // Style header row
      summarySheet.getRow(1).font = { bold: true };
      summarySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '1890FF' }
      };
      summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };

      summarySheet.addRows([
        { metric: 'Report Period', value: `${date_from} to ${date_to}` },
        { metric: 'Total Tickets Resolved', value: report.summary.total_resolved || 0 },
        { metric: 'Resolved Within SLA', value: report.summary.resolved_within_sla || 0 },
        { metric: 'Resolved Breached', value: report.summary.resolved_breached || 0 },
        { metric: 'Compliance Rate (%)', value: report.summary.compliance_rate || 0 },
        { metric: 'Avg Resolution Time (minutes)', value: report.summary.avg_resolution_minutes || 0 }
      ]);

      // Period Breakdown Sheet (if frequency specified)
      if (report.by_period && report.by_period.length > 0) {
        const periodSheet = workbook.addWorksheet('By Period');
        periodSheet.columns = [
          { header: 'Period', key: 'period', width: 15 },
          { header: 'Total Resolved', key: 'total_resolved', width: 15 },
          { header: 'Within SLA', key: 'resolved_within_sla', width: 15 },
          { header: 'Breached', key: 'resolved_breached', width: 12 },
          { header: 'Compliance %', key: 'compliance_rate', width: 15 },
          { header: 'Avg Resolution (min)', key: 'avg_resolution_minutes', width: 20 }
        ];

        periodSheet.getRow(1).font = { bold: true };
        periodSheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '1890FF' }
        };
        periodSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };

        periodSheet.addRows(report.by_period);
      }

      // Location Breakdown Sheet
      if (report.by_location && report.by_location.length > 0) {
        const locationSheet = workbook.addWorksheet('By Location');
        locationSheet.columns = [
          { header: 'Location', key: 'location_name', width: 25 },
          { header: 'Total Resolved', key: 'total_resolved', width: 15 },
          { header: 'Within SLA', key: 'resolved_within_sla', width: 15 },
          { header: 'Compliance %', key: 'compliance_rate', width: 15 }
        ];

        locationSheet.getRow(1).font = { bold: true };
        locationSheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '52C41A' }
        };
        locationSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };

        locationSheet.addRows(report.by_location);
      }

      // Department Breakdown Sheet
      if (report.by_department && report.by_department.length > 0) {
        const deptSheet = workbook.addWorksheet('By Department');
        deptSheet.columns = [
          { header: 'Department', key: 'department_name', width: 25 },
          { header: 'Total Resolved', key: 'total_resolved', width: 15 },
          { header: 'Within SLA', key: 'resolved_within_sla', width: 15 },
          { header: 'Compliance %', key: 'compliance_rate', width: 15 }
        ];

        deptSheet.getRow(1).font = { bold: true };
        deptSheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FA8C16' }
        };
        deptSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };

        deptSheet.addRows(report.by_department);
      }

      // Detailed Tickets Sheet
      if (report.details && report.details.length > 0) {
        const detailSheet = workbook.addWorksheet('Ticket Details');
        detailSheet.columns = [
          { header: 'Ticket #', key: 'ticket_number', width: 15 },
          { header: 'Title', key: 'title', width: 30 },
          { header: 'Category', key: 'category', width: 15 },
          { header: 'Priority', key: 'priority', width: 12 },
          { header: 'Location', key: 'location_name', width: 20 },
          { header: 'Department', key: 'department_name', width: 20 },
          { header: 'Engineer', key: 'engineer_name', width: 20 },
          { header: 'SLA Rule', key: 'rule_name', width: 20 },
          { header: 'SLA Started', key: 'sla_start_time', width: 20 },
          { header: 'Resolved At', key: 'resolved_at', width: 20 },
          { header: 'Resolution Time (min)', key: 'business_elapsed_minutes', width: 20 },
          { header: 'Max TAT (min)', key: 'max_tat_minutes', width: 15 },
          { header: 'SLA Met', key: 'met_sla', width: 10 },
          { header: 'Final Status', key: 'final_status', width: 12 }
        ];

        detailSheet.getRow(1).font = { bold: true };
        detailSheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '722ED1' }
        };
        detailSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };

        // Format dates and add rows
        const formattedDetails = report.details.map(d => ({
          ...d,
          sla_start_time: d.sla_start_time ? new Date(d.sla_start_time).toLocaleString() : '',
          resolved_at: d.resolved_at ? new Date(d.resolved_at).toLocaleString() : '',
          met_sla: d.met_sla ? 'Yes' : 'No'
        }));

        detailSheet.addRows(formattedDetails);

        // Conditional formatting for SLA Met column
        formattedDetails.forEach((_, index) => {
          const row = detailSheet.getRow(index + 2);
          const metSlaCell = row.getCell('met_sla');
          if (metSlaCell.value === 'No') {
            metSlaCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFCCC7' }
            };
          } else {
            metSlaCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'D9F7BE' }
            };
          }
        });
      }

      // Set response headers
      const filename = `SLA_Compliance_Report_${date_from}_to_${date_to}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // Write to response
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Error exporting SLA compliance report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export SLA compliance report',
        error: error.message
      });
    }
  }
}

module.exports = SlaController;
