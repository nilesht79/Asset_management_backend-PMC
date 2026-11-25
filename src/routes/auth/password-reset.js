/**
 * PASSWORD RESET ROUTES
 * Handles forgot password and reset password functionality
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { connectDB, sql } = require('../../config/database');
const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError } = require('../../utils/response');
const authConfig = require('../../config/auth');
const emailService = require('../../services/emailService');

const router = express.Router();

// Token expiry time: 1 hour
const TOKEN_EXPIRY_HOURS = 1;

// // Frontend URL for reset password page
// const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Frontend URL for reset password page
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

if (!FRONTEND_URL) {
  throw new Error('FRONTEND_URL is not configured in environment variables');
}

/**
 * Generate a secure random token
 */
const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Hash the token for secure storage
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * POST /auth/forgot-password
 * Request a password reset link
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return sendError(res, 'Email is required', 400);
  }

  const pool = await connectDB();

  // Find user by email (case-insensitive)
  const userResult = await pool.request()
    .input('email', sql.VarChar(255), email.toLowerCase().trim())
    .query(`
      SELECT user_id, email, first_name, last_name, is_active
      FROM USER_MASTER
      WHERE LOWER(email) = @email
    `);

  // Always return success to prevent email enumeration attacks
  // Even if user doesn't exist, we return success
  if (userResult.recordset.length === 0) {
    console.log(`Password reset requested for non-existent email: ${email}`);
    return sendSuccess(res, null, 'If an account with that email exists, a password reset link has been sent.');
  }

  const user = userResult.recordset[0];

  // Check if user is active
  if (!user.is_active) {
    console.log(`Password reset requested for inactive user: ${email}`);
    return sendSuccess(res, null, 'If an account with that email exists, a password reset link has been sent.');
  }

  // Invalidate any existing reset tokens for this user
  await pool.request()
    .input('userId', sql.UniqueIdentifier, user.user_id)
    .query(`
      DELETE FROM PASSWORD_RESET_TOKENS
      WHERE user_id = @userId
    `);

  // Generate new token
  const resetToken = generateResetToken();
  const tokenHash = hashToken(resetToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Store hashed token in database
  await pool.request()
    .input('userId', sql.UniqueIdentifier, user.user_id)
    .input('tokenHash', sql.VarChar(255), tokenHash)
    .input('expiresAt', sql.DateTime, expiresAt)
    .query(`
      INSERT INTO PASSWORD_RESET_TOKENS (user_id, token_hash, expires_at)
      VALUES (@userId, @tokenHash, @expiresAt)
    `);

  // Build reset URL (token is NOT hashed in URL)
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

  // Send email
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset</title>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #ef4444; margin: 0; font-size: 24px;">Password Reset Request</h1>
          </div>

          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            Hello <strong>${user.first_name}</strong>,
          </p>

          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            We received a request to reset your password for your Unified ITSM Platform account.
            Click the button below to reset your password:
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}"
               style="background-color: #ef4444; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 16px;">
              Reset Password
            </a>
          </div>

          <p style="color: #666; font-size: 14px; line-height: 1.6;">
            This link will expire in <strong>${TOKEN_EXPIRY_HOURS} hour(s)</strong>.
          </p>

          <p style="color: #666; font-size: 14px; line-height: 1.6;">
            If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
          </p>

          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

          <p style="color: #999; font-size: 12px; line-height: 1.6;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${resetUrl}" style="color: #ef4444; word-break: break-all;">${resetUrl}</a>
          </p>

          <p style="color: #999; font-size: 12px; line-height: 1.6; margin-top: 20px;">
            &copy; ${new Date().getFullYear()} Unified ITSM Platform. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const emailText = `
Hello ${user.first_name},

We received a request to reset your password for your Unified ITSM Platform account.

Click the link below to reset your password:
${resetUrl}

This link will expire in ${TOKEN_EXPIRY_HOURS} hour(s).

If you didn't request a password reset, please ignore this email. Your password will remain unchanged.

© ${new Date().getFullYear()} Unified ITSM Platform. All rights reserved.
  `;

  const emailResult = await emailService.sendHtmlEmail(
    user.email,
    'Password Reset - Unified ITSM Platform',
    emailHtml,
    emailText
  );

  if (emailResult.success) {
    console.log(`Password reset email sent to: ${user.email}`);
  } else {
    console.log(`Failed to send password reset email to ${user.email}:`, emailResult.error || emailResult.reason);
  }

  // Always return success to prevent email enumeration
  sendSuccess(res, null, 'If an account with that email exists, a password reset link has been sent.');
}));

/**
 * POST /auth/reset-password
 * Reset password using token
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, new_password } = req.body;

  if (!token) {
    return sendError(res, 'Reset token is required', 400);
  }

  if (!new_password) {
    return sendError(res, 'New password is required', 400);
  }

  // Validate password strength
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(new_password)) {
    return sendError(res, 'Password must be at least 8 characters with uppercase, lowercase, number and special character (@$!%*?&)', 400);
  }

  const pool = await connectDB();

  // Hash the provided token to compare with stored hash
  const tokenHash = hashToken(token);

  // Find valid token
  const tokenResult = await pool.request()
    .input('tokenHash', sql.VarChar(255), tokenHash)
    .query(`
      SELECT t.id, t.user_id, t.expires_at, t.used_at,
             u.email, u.first_name, u.is_active
      FROM PASSWORD_RESET_TOKENS t
      JOIN USER_MASTER u ON t.user_id = u.user_id
      WHERE t.token_hash = @tokenHash
    `);

  if (tokenResult.recordset.length === 0) {
    return sendError(res, 'Invalid or expired reset token', 400);
  }

  const resetToken = tokenResult.recordset[0];

  // Check if token has already been used
  if (resetToken.used_at) {
    return sendError(res, 'This reset link has already been used', 400);
  }

  // Check if token has expired
  if (new Date(resetToken.expires_at) < new Date()) {
    return sendError(res, 'This reset link has expired. Please request a new one.', 400);
  }

  // Check if user is active
  if (!resetToken.is_active) {
    return sendError(res, 'Your account is inactive. Please contact support.', 400);
  }

  // Hash new password
  const newPasswordHash = await bcrypt.hash(new_password, authConfig.bcrypt.saltRounds);

  // Update password and mark token as used
  await pool.request()
    .input('userId', sql.UniqueIdentifier, resetToken.user_id)
    .input('passwordHash', sql.VarChar(255), newPasswordHash)
    .input('tokenId', sql.UniqueIdentifier, resetToken.id)
    .query(`
      -- Update user password
      UPDATE USER_MASTER
      SET password_hash = @passwordHash,
          failed_login_attempts = 0,
          account_locked_until = NULL,
          updated_at = GETUTCDATE()
      WHERE user_id = @userId;

      -- Mark token as used
      UPDATE PASSWORD_RESET_TOKENS
      SET used_at = GETUTCDATE()
      WHERE id = @tokenId;
    `);

  // Revoke all OAuth tokens to force re-login with new password
  await pool.request()
    .input('userId', sql.UniqueIdentifier, resetToken.user_id)
    .query(`
      UPDATE oauth_access_tokens SET is_revoked = 1 WHERE user_id = @userId;
      UPDATE oauth_refresh_tokens SET is_revoked = 1 WHERE user_id = @userId;
    `);

  // Clean up old tokens for this user
  await pool.request()
    .input('userId', sql.UniqueIdentifier, resetToken.user_id)
    .query(`
      DELETE FROM PASSWORD_RESET_TOKENS
      WHERE user_id = @userId
    `);

  console.log(`Password reset successful for user: ${resetToken.email}`);

  sendSuccess(res, null, 'Password has been reset successfully. You can now login with your new password.');
}));

/**
 * GET /auth/verify-reset-token
 * Verify if a reset token is valid (for frontend to show appropriate UI)
 */
router.get('/verify-reset-token', asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return sendError(res, 'Token is required', 400);
  }

  const pool = await connectDB();
  const tokenHash = hashToken(token);

  const tokenResult = await pool.request()
    .input('tokenHash', sql.VarChar(255), tokenHash)
    .query(`
      SELECT t.expires_at, t.used_at, u.is_active
      FROM PASSWORD_RESET_TOKENS t
      JOIN USER_MASTER u ON t.user_id = u.user_id
      WHERE t.token_hash = @tokenHash
    `);

  if (tokenResult.recordset.length === 0) {
    return sendError(res, 'Invalid reset token', 400);
  }

  const resetToken = tokenResult.recordset[0];

  if (resetToken.used_at) {
    return sendError(res, 'This reset link has already been used', 400);
  }

  if (new Date(resetToken.expires_at) < new Date()) {
    return sendError(res, 'This reset link has expired', 400);
  }

  if (!resetToken.is_active) {
    return sendError(res, 'Account is inactive', 400);
  }

  sendSuccess(res, { valid: true }, 'Token is valid');
}));

module.exports = router;
