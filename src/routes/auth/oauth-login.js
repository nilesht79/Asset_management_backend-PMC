const express = require('express');
const { asyncHandler } = require('../../middleware/error-handler');
const { validateBody } = require('../../middleware/validation');
const { sendSuccess, sendError, sendUnauthorized, sendValidationError } = require('../../utils/response');
const validators = require('../../utils/validators');
const OAuth2Server = require('../../oauth/server');
const OAuth2ClientManager = require('../../oauth/clients');
const OAuth2Request = require('oauth2-server/lib/request');
const OAuth2Response = require('oauth2-server/lib/response');
const { getAccessTokenCookieOptions, getRefreshTokenCookieOptions, getClearCookieOptions } = require('../../config/cookies');
const { connectDB, sql } = require('../../config/database');
const { auditService } = require('../../services/auditService');

const router = express.Router();

// OAuth 2.0 Resource Owner Password Credentials Grant
// This allows direct username/password login that returns OAuth tokens
router.post('/oauth-login',
  validateBody(validators.auth.oauthLogin),
  asyncHandler(async (req, res) => {
    const { employeeId, password, client_id, client_secret, scope, role } = req.body;

    try {
      // Verify client credentials
      if (!client_id) {
        return sendValidationError(res, 'client_id is required for OAuth login');
      }

      const client = await OAuth2ClientManager.getClient(client_id, true);
      if (!client) {
        return sendUnauthorized(res, 'Invalid client credentials');
      }

      // Verify client secret if provided (required for confidential clients)
      if (client.isConfidential && client_secret) {
        const bcrypt = require('bcryptjs');
        const isValidSecret = await bcrypt.compare(client_secret, client.clientSecret);
        if (!isValidSecret) {
          return sendUnauthorized(res, 'Invalid client credentials');
        }
      }

      // Check if client supports password grant
      if (!client.grants.includes('password')) {
        return sendError(res, 'Client does not support password grant type', 400);
      }

      // Create OAuth2Server Request object
      const oauthRequest = new OAuth2Request({
        body: {
          grant_type: 'password',
          username: employeeId,
          password: password,
          client_id: client_id,
          client_secret: client_secret,
          scope: scope || 'read write'
        },
        headers: {
          ...req.headers,
          'content-type': 'application/x-www-form-urlencoded'
        },
        method: 'POST',
        query: req.query || {}
      });

      // Create OAuth2Server Response object
      const oauthResponse = new OAuth2Response({
        body: {},
        headers: {}
      });

      // Get OAuth token
      const tokenResponse = await OAuth2Server.token(oauthRequest, oauthResponse);

      // Customize response for role-specific login if needed
      let loginMessage = 'Login successful';
      if (role && tokenResponse.user.role !== role) {
        return sendUnauthorized(res, `Invalid role. This login is specifically for ${role}s.`);
      }

      if (role) {
        loginMessage = `Login successful as ${tokenResponse.user.role}`;
      }

      // Set tokens as HttpOnly cookies for security using centralized config
      const accessCookieOptions = getAccessTokenCookieOptions(tokenResponse.expires_in);
      const refreshCookieOptions = getRefreshTokenCookieOptions(); // Default 30 days

      res.cookie('access_token', tokenResponse.access_token, accessCookieOptions);
      res.cookie('refresh_token', tokenResponse.refresh_token, refreshCookieOptions);

      // Query database directly for must_change_password since oauth2-server strips custom user properties
      const pool = await connectDB();
      console.log("TOKEN RESPONSE USER =>", tokenResponse.user);
      const userResult = await pool.request()
        // .input('userId', sql.UniqueIdentifier, tokenResponse.user.id)
        .input(
  'userId',
  sql.UniqueIdentifier,
  tokenResponse.user.id || tokenResponse.user.user_id
)
        .query('SELECT must_change_password FROM USER_MASTER WHERE user_id = @userId');

      const mustChangePassword = userResult.recordset.length > 0
        ? Boolean(userResult.recordset[0].must_change_password)
        : false;

      // Audit: Log successful login
      await auditService.logLoginSuccess(req, tokenResponse.user, 'password');

      return sendSuccess(res, {
        user: {
          id: tokenResponse.user.id,
          email: tokenResponse.user.email,
          firstName: tokenResponse.user.firstName,
          lastName: tokenResponse.user.lastName,
          role: tokenResponse.user.role,
          employeeId: tokenResponse.user.employeeId,
          mustChangePassword: mustChangePassword,
          department: tokenResponse.user.department,
          location: tokenResponse.user.location,
          permissions: tokenResponse.user.permissions
        },
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        scope: tokenResponse.scope
      }, loginMessage);

    } catch (error) {
      console.error('OAuth login error:', error);

      // Audit: Log failed login attempt
      let failureReason = 'Unknown error';
      if (error.name === 'invalid_grant') {
        failureReason = 'Invalid Employee ID or password';
        await auditService.logLoginFailure(req, employeeId, failureReason);
        return sendUnauthorized(res, failureReason);
      } else if (error.name === 'invalid_client') {
        failureReason = 'Invalid client credentials';
        await auditService.logLoginFailure(req, employeeId, failureReason);
        return sendUnauthorized(res, failureReason);
      } else if (error.name === 'unsupported_grant_type') {
        return sendError(res, 'Unsupported grant type', 400);
      }

      await auditService.logLoginFailure(req, employeeId, 'Login failed - server error');
      return sendError(res, 'Login failed', 500);
    }
  })
);

// OAuth 2.0 Refresh Token endpoint
router.post('/oauth-refresh',
  validateBody(validators.auth.oauthRefresh),
  asyncHandler(async (req, res) => {
    // Get refresh token from HttpOnly cookie
    const refresh_token = req.cookies?.refresh_token;
    const { client_id, client_secret } = req.body;

    if (!refresh_token) {
      console.log('No refresh token found in cookies for refresh attempt');
      return sendUnauthorized(res, 'Refresh token required - please login again');
    }

    try {
      // Create OAuth2Server Request object
      const oauthRequest = new OAuth2Request({
        body: {
          grant_type: 'refresh_token',
          refresh_token: refresh_token,
          client_id: client_id,
          client_secret: client_secret
        },
        headers: {
          ...req.headers,
          'content-type': 'application/x-www-form-urlencoded'
        },
        method: 'POST',
        query: req.query || {}
      });

      // Create OAuth2Server Response object
      const oauthResponse = new OAuth2Response({
        body: {},
        headers: {}
      });

      const tokenResponse = await OAuth2Server.token(oauthRequest, oauthResponse);

      // Set refreshed tokens as HttpOnly cookies using centralized config
      const accessCookieOptions = getAccessTokenCookieOptions(tokenResponse.expires_in);
      const refreshCookieOptions = getRefreshTokenCookieOptions(); // Default 30 days

      res.cookie('access_token', tokenResponse.access_token, accessCookieOptions);

      if (tokenResponse.refresh_token) {
        res.cookie('refresh_token', tokenResponse.refresh_token, refreshCookieOptions);
      }

      return sendSuccess(res, {
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        scope: tokenResponse.scope
      }, 'Token refreshed successfully');

    } catch (error) {
      console.error('OAuth refresh error:', error);

      if (error.name === 'invalid_grant') {
        return sendUnauthorized(res, 'Invalid or expired refresh token');
      } else if (error.name === 'invalid_client') {
        return sendUnauthorized(res, 'Invalid client credentials');
      }

      return sendError(res, 'Token refresh failed', 500);
    }
  })
);

// Role-specific OAuth login endpoints
const createRoleLogin = (role) => {
  return asyncHandler(async (req, res) => {
    req.body.role = role; // Set the expected role

    // Forward to main OAuth login handler
    const oauthLoginHandler = router.stack.find(
      layer => layer.route && layer.route.path === '/oauth-login' && layer.route.methods.post
    );

    if (oauthLoginHandler && oauthLoginHandler.route.stack[1]) {
      return oauthLoginHandler.route.stack[1].handle(req, res);
    }

    return sendError(res, 'OAuth login handler not found', 500);
  });
};

// Role-specific OAuth login routes
router.post('/oauth-coordinator-login',
  validateBody(validators.auth.oauthLogin),
  createRoleLogin('coordinator')
);

router.post('/oauth-engineer-login',
  validateBody(validators.auth.oauthLogin),
  createRoleLogin('engineer')
);

router.post('/oauth-department-head-login',
  validateBody(validators.auth.oauthLogin),
  createRoleLogin('department_head')
);

router.post('/oauth-department-coordinator-login',
  validateBody(validators.auth.oauthLogin),
  createRoleLogin('department_coordinator')
);

router.post('/oauth-admin-login',
  validateBody(validators.auth.oauthLogin),
  createRoleLogin('admin')
);

router.post('/oauth-superadmin-login',
  validateBody(validators.auth.oauthLogin),
  createRoleLogin('superadmin')
);

// OAuth 2.0 Logout endpoint - clears HttpOnly cookies
router.post('/oauth-logout',
  asyncHandler(async (req, res) => {
    try {
      // Audit: Log logout
      await auditService.logLogout(req);

      // Clear the HttpOnly cookies using centralized config
      const clearCookieOptions = getClearCookieOptions();

      res.clearCookie('access_token', clearCookieOptions);
      res.clearCookie('refresh_token', clearCookieOptions);

      return sendSuccess(res, null, 'Logout successful');
    } catch (error) {
      console.error('OAuth logout error:', error);
      return sendError(res, 'Logout failed', 500);
    }
  })
);

// TEST PASSWORD API
router.post('/test-password', async (req, res) => {
  try {

    const { employeeId, password } = req.body;

    const bcrypt = require('bcryptjs');

    const pool = await connectDB();

    const result = await pool.request()
      .input('employeeId', sql.VarChar, employeeId)
      .query(`
        SELECT employee_id, password_hash
        FROM USER_MASTER
        WHERE employee_id = @employeeId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.recordset[0];

    console.log("Entered Password:", password);
    console.log("Stored Hash:", user.password_hash);

    const isMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    return res.json({
      success: true,
      employeeId: user.employee_id,
      enteredPassword: password,
      storedHash: user.password_hash,
      passwordMatched: isMatch
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: 'Password check failed'
    });
  }
});

module.exports = router;
