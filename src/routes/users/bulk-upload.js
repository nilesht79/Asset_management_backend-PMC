const express = require('express');
const { connectDB, sql } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError, sendCreated } = require('../../utils/response');
const { roles: USER_ROLES } = require('../../config/auth');
const { upload, handleUploadError } = require('../../middleware/upload');
const { generateUserUploadTemplate } = require('../../utils/excel-template');
const {
  parseUserExcel,
  validateBulkUsers,
  processUserForInsertion
} = require('../../utils/bulk-user-processor');
const { generateCredentialsExport } = require('../../utils/credentials-export');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /users/bulk-upload/template
 * Download Excel template for bulk user upload
 */
router.get('/template',
  // requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
           requireRole([
  USER_ROLES.ADMIN,
  USER_ROLES.SUPERADMIN,
  USER_ROLES.COORDINATOR
])
  asyncHandler(async (req, res) => {
    const pool = await connectDB();

    // Get all departments for the template
    const departmentsResult = await pool.request().query(`
      SELECT department_id, department_name, description
      FROM DEPARTMENT_MASTER
      ORDER BY department_name
    `);

    const departments = departmentsResult.recordset;

    // Generate template
    const buffer = await generateUserUploadTemplate(departments);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=bulk-user-upload-template.xlsx');
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  })
);

/**
 * POST /users/bulk-upload
 * Upload and process Excel file for bulk user creation
 */
router.post('/',
  // requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  requireRole([
  USER_ROLES.ADMIN,
  USER_ROLES.SUPERADMIN,
  USER_ROLES.COORDINATOR
])
  upload.single('file'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    const pool = await connectDB();

    try {
      // Parse Excel file
      const users = await parseUserExcel(req.file.buffer);

      if (users.length === 0) {
        return sendError(res, 'No user data found in Excel file', 400);
      }

      if (users.length > 500) {
        return sendError(res, 'Maximum 500 users can be uploaded at once', 400);
      }

      // Validate all users
      const { validationResults, departments, locations, totalRows, validRows, invalidRows } = await validateBulkUsers(users, pool);

      // If there are validation errors, return them
      if (invalidRows > 0) {
        const errors = validationResults
          .filter(r => !r.valid)
          .map(r => ({
            row: r.rowNumber,
            email: r.user.email,
            name: `${r.user.first_name || ''} ${r.user.last_name || ''}`.trim(),
            errors: r.errors
          }));

        return res.status(400).json({
          success: false,
          message: `Validation failed for ${invalidRows} out of ${totalRows} rows`,
          summary: {
            total: totalRows,
            valid: validRows,
            invalid: invalidRows
          },
          errors,
          availableDepartments: departments.map(d => d.department_name)
        });
      }

      // Begin transaction for bulk insert
      const transaction = pool.transaction();
      await transaction.begin();

      const successfulUsers = [];
      const failedUsers = [];
      const batchEmails = new Set();
      const employeeIdTracker = { initialized: false, nextNumber: 10000 }; // Track employee ID sequence

      try {
        for (const result of validationResults) {
          if (!result.valid) continue;

          try {
            // Process and prepare user data
            const userData = await processUserForInsertion(result.user, departments, batchEmails, pool, employeeIdTracker, locations);

            const currentUser = req.oauth.user;

            if (currentUser.role === USER_ROLES.COORDINATOR) {
              const allowedRoles = [
                USER_ROLES.DEPARTMENT_COORDINATOR,
                USER_ROLES.ENGINEER,
                USER_ROLES.EMPLOYEE
              ];
            
              if (!allowedRoles.includes(userData.role)) {
                throw new Error(
                  `Coordinator cannot bulk upload users with role: ${userData.role}`
                );
              }
            }

            // Add email to batch set to avoid duplicates
            batchEmails.add(userData.email.toLowerCase());

            // Insert user into database (no password - users must use reset password flow)
            await transaction.request()
              .input('user_id', sql.UniqueIdentifier, userData.user_id)
              .input('first_name', sql.VarChar(50), userData.first_name)
              .input('last_name', sql.VarChar(50), userData.last_name)
              .input('email', sql.VarChar(255), userData.email)
              .input('role', sql.VarChar(50), userData.role)
              .input('employee_id', sql.VarChar(20), userData.employee_id)
              .input('designation', sql.VarChar(100), userData.designation)
              .input('department_id', sql.UniqueIdentifier, userData.department_id)
              .input('location_id', sql.UniqueIdentifier, userData.location_id)
              .input('is_active', sql.Bit, userData.is_active)
              .input('is_vip', sql.Bit, userData.is_vip)
              .input('email_verified', sql.Bit, userData.email_verified)
              .input('registration_type', sql.VarChar(20), userData.registration_type)
              .input('user_status', sql.VarChar(20), userData.user_status)
              .input('must_change_password', sql.Bit, userData.must_change_password)
              .query(`
                INSERT INTO USER_MASTER (
                  user_id, first_name, last_name, email, role,
                  employee_id, designation, department_id, location_id, is_active, is_vip, email_verified,
                  registration_type, user_status, must_change_password, created_at, updated_at
                )
                VALUES (
                  @user_id, @first_name, @last_name, @email, @role,
                  @employee_id, @designation, @department_id, @location_id, @is_active, @is_vip, @email_verified,
                  @registration_type, @user_status, @must_change_password, GETUTCDATE(), GETUTCDATE()
                )
              `);

            successfulUsers.push({
              row: result.rowNumber,
              email: userData.email,
              name: `${userData.first_name} ${userData.last_name}`,
              employeeId: userData.employee_id,
              role: userData.role
            });

          } catch (insertError) {
            failedUsers.push({
              row: result.rowNumber,
              email: result.user.email,
              name: `${result.user.first_name || ''} ${result.user.last_name || ''}`.trim(),
              error: insertError.message
            });
          }
        }

        // Commit transaction if all successful
        if (failedUsers.length === 0) {
          await transaction.commit();

          return sendCreated(res, {
            summary: {
              total: totalRows,
              successful: successfulUsers.length,
              failed: 0
            },
            users: successfulUsers
          }, `Successfully created ${successfulUsers.length} users`);
        } else {
          // Rollback if there are failures
          await transaction.rollback();

          return res.status(207).json({ // 207 Multi-Status
            success: false,
            message: `${failedUsers.length} users failed to create. Transaction rolled back.`,
            summary: {
              total: totalRows,
              successful: 0,
              failed: failedUsers.length
            },
            errors: failedUsers
          });
        }

      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }

    } catch (error) {
      console.error('Bulk upload error:', error);
      return sendError(res, `Failed to process bulk upload: ${error.message}`, 500);
    }
  })
);

/**
 * POST /users/bulk-upload/validate
 * Validate Excel file without inserting data
 */
router.post('/validate',
  // requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  requireRole([
  USER_ROLES.ADMIN,
  USER_ROLES.SUPERADMIN,
  USER_ROLES.COORDINATOR
])
  upload.single('file'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    const pool = await connectDB();

    try {
      // Parse Excel file
      const users = await parseUserExcel(req.file.buffer);

      if (users.length === 0) {
        return sendError(res, 'No user data found in Excel file', 400);
      }

      // Validate all users
      const { validationResults, departments, totalRows, validRows, invalidRows } = await validateBulkUsers(users, pool);

      const response = {
        summary: {
          total: totalRows,
          valid: validRows,
          invalid: invalidRows
        },
        results: validationResults.map(r => ({
          row: r.rowNumber,
          email: r.user.email,
          name: `${r.user.first_name || ''} ${r.user.last_name || ''}`.trim(),
          valid: r.valid,
          errors: r.errors
        })),
        availableDepartments: departments.map(d => d.department_name)
      };

      if (invalidRows > 0) {
        return res.status(200).json({
          success: true,
          message: `Validation complete: ${validRows} valid, ${invalidRows} invalid`,
          data: response
        });
      }

      return sendSuccess(res, response, `All ${validRows} records are valid and ready for upload`);

    } catch (error) {
      console.error('Validation error:', error);
      return sendError(res, `Failed to validate file: ${error.message}`, 500);
    }
  })
);

/**
 * POST /users/bulk-upload/export-credentials
 * Generate Excel file with user credentials for distribution
 * Body should contain array of users with credentials from upload response
 */
router.post('/export-credentials',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const { users } = req.body;

    if (!users || !Array.isArray(users) || users.length === 0) {
      return sendError(res, 'No user credentials provided', 400);
    }

    try {
      // Generate credentials export file
      const buffer = await generateCredentialsExport(users);

      // Set headers for file download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=user-credentials-${Date.now()}.xlsx`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);

    } catch (error) {
      console.error('Credentials export error:', error);
      return sendError(res, `Failed to export credentials: ${error.message}`, 500);
    }
  })
);

module.exports = router;
