const { connectDB, sql } = require('../config/database');

const REPORT_ROLES = [
  'it_head',
  'coordinator',
  'superadmin',
  'admin'
];

const getReport = async (req, res) => {
  try {
    const { category } = req.params;

    const allowedCategories = [
  'VC Calls',
  'Server',
  'Server Issue'
];

    if (!allowedCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report category'
      });
    }

    const pool = await connectDB();

    const result = await pool.request()
      .input('category', sql.NVarChar(100), category)
      .query(`
        SELECT
          t.ticket_id,
          t.ticket_number,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.category,
          t.service_type,
          t.ticket_type,
          t.ticket_channel,

          t.department_id,
          dm.department_name AS department_name,

          t.location_id,
          l.name AS location_name,

          t.assigned_to_engineer_id,
          CONCAT(
            ISNULL(engineer.first_name, ''),
            CASE
              WHEN engineer.first_name IS NOT NULL
               AND engineer.last_name IS NOT NULL
              THEN ' '
              ELSE ''
            END,
            ISNULL(engineer.last_name, '')
          ) AS assigned_engineer_name,

          t.created_by_user_id,
          CONCAT(
            ISNULL(creator.first_name, ''),
            CASE
              WHEN creator.first_name IS NOT NULL
               AND creator.last_name IS NOT NULL
              THEN ' '
              ELSE ''
            END,
            ISNULL(creator.last_name, '')
          ) AS created_by_user_name,

          t.due_date,
          t.resolved_at,
          t.closed_at,
          t.resolution_notes,
          t.created_at,
          t.updated_at,

          -- SLA information
          tst.tracking_id,
          tst.sla_rule_id,
          tst.sla_start_time,
          tst.min_target_time,
          tst.avg_target_time,
          tst.max_target_time,
          tst.total_elapsed_minutes,
          tst.business_elapsed_minutes,
          tst.total_paused_minutes,
          tst.is_paused,
          tst.current_pause_reason,
          tst.sla_status,
          tst.warning_triggered_at,
          tst.breach_triggered_at,
          tst.resolved_at AS sla_resolved_at,
          tst.final_status AS sla_final_status,
          tst.last_calculated_at,

          -- SLA rule information
          sr.rule_name,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes

        FROM TICKETS t

        LEFT JOIN USER_MASTER creator
          ON t.created_by_user_id = creator.user_id

        LEFT JOIN USER_MASTER engineer
          ON t.assigned_to_engineer_id = engineer.user_id

        LEFT JOIN DEPARTMENT_MASTER dm
          ON t.department_id = dm.department_id

        LEFT JOIN locations l
          ON t.location_id = l.id

        LEFT JOIN TICKET_SLA_TRACKING tst
          ON t.ticket_id = tst.ticket_id

        LEFT JOIN SLA_RULES sr
          ON tst.sla_rule_id = sr.rule_id

        WHERE t.category = @category

        ORDER BY t.created_at DESC
      `);

    return res.status(200).json({
      success: true,
      category,
      count: result.recordset.length,
      data: result.recordset
    });

  } catch (error) {
    console.error('Error getting report:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch report',
      error: error.message
    });
  }
};

const getVCCallReport = async (req, res) => {
  req.params.category = 'VC Calls';
  return getReport(req, res);
};

const getServerReport = async (req, res) => {
  try {
    const pool = await connectDB();

    const result = await pool.request()
      .query(`
        SELECT
          t.ticket_id,
          t.ticket_number,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.category,
          t.service_type,
          t.ticket_type,
          t.ticket_channel,

          t.department_id,
          dm.department_name AS department_name,

          t.location_id,
          l.name AS location_name,

          t.assigned_to_engineer_id,
          CONCAT(
            ISNULL(engineer.first_name, ''),
            CASE
              WHEN engineer.first_name IS NOT NULL
               AND engineer.last_name IS NOT NULL
              THEN ' '
              ELSE ''
            END,
            ISNULL(engineer.last_name, '')
          ) AS assigned_engineer_name,

          t.created_by_user_id,
          CONCAT(
            ISNULL(creator.first_name, ''),
            CASE
              WHEN creator.first_name IS NOT NULL
               AND creator.last_name IS NOT NULL
              THEN ' '
              ELSE ''
            END,
            ISNULL(creator.last_name, '')
          ) AS created_by_user_name,

          t.due_date,
          t.resolved_at,
          t.closed_at,
          t.resolution_notes,
          t.created_at,
          t.updated_at,

          tst.tracking_id,
          tst.sla_rule_id,
          tst.sla_start_time,
          tst.min_target_time,
          tst.avg_target_time,
          tst.max_target_time,
          tst.total_elapsed_minutes,
          tst.business_elapsed_minutes,
          tst.total_paused_minutes,
          tst.is_paused,
          tst.current_pause_reason,
          tst.sla_status,
          tst.warning_triggered_at,
          tst.breach_triggered_at,
          tst.resolved_at AS sla_resolved_at,
          tst.final_status AS sla_final_status,
          tst.last_calculated_at,

          sr.rule_name,
          sr.min_tat_minutes,
          sr.avg_tat_minutes,
          sr.max_tat_minutes

        FROM TICKETS t

        LEFT JOIN USER_MASTER creator
          ON t.created_by_user_id = creator.user_id

        LEFT JOIN USER_MASTER engineer
          ON t.assigned_to_engineer_id = engineer.user_id

        LEFT JOIN DEPARTMENT_MASTER dm
          ON t.department_id = dm.department_id

        LEFT JOIN locations l
          ON t.location_id = l.id

        LEFT JOIN TICKET_SLA_TRACKING tst
          ON t.ticket_id = tst.ticket_id

        LEFT JOIN SLA_RULES sr
          ON tst.sla_rule_id = sr.rule_id

        WHERE t.category IN ('Server', 'Server Issue')

        ORDER BY t.created_at DESC
      `);

    return res.status(200).json({
      success: true,
      category: 'Server Issue',
      count: result.recordset.length,
      data: result.recordset
    });

  } catch (error) {
    console.error('Error getting server report:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Server Reports',
      error: error.message
    });
  }
};

module.exports = {
  REPORT_ROLES,
  getReport,
  getVCCallReport,
  getServerReport
};
