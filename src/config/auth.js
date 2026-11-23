require('dotenv').config();

module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: 'asset-management-system',
    audience: 'asset-management-users',
    roleBasedExpiry: {
      superadmin: '24h',
      admin: '12h',
      it_head: '10h',
      department_head: '8h',
      coordinator: '8h',
      department_coordinator: '8h',
      engineer: '6h',
      employee: '6h'
    }
  },
  
  bcrypt: {
    saltRounds: 12
  },
  
  session: {
    maxSessions: 3, // Maximum concurrent sessions per user
    sessionTimeout: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  },
  
  password: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxAttempts: 5,
    lockoutDuration: 15 * 60 * 1000 // 15 minutes
  },
  
  roles: {
    SUPERADMIN: 'superadmin',
    ADMIN: 'admin',
    IT_HEAD: 'it_head',
    DEPARTMENT_HEAD: 'department_head',
    COORDINATOR: 'coordinator',
    DEPARTMENT_COORDINATOR: 'department_coordinator',
    ENGINEER: 'engineer',
    EMPLOYEE: 'employee'
  },
  

  // Role hierarchy for permission management
  ROLE_HIERARCHY: {
    superadmin: 100,
    admin: 90,
    it_head: 80,
    department_head: 70,
    coordinator: 60,
    department_coordinator: 50,
    engineer: 30,
    employee: 10
  },

  // Legacy permission constants for backward compatibility
  permissions: {
    MASTER_READ: 'masters.read',
    MASTER_CREATE: 'masters.create',
    MASTER_UPDATE: 'masters.update',
    MASTER_DELETE: 'masters.delete',
    MASTER_WRITE: 'masters.write',
    ASSET_READ: 'assets.read',
    ASSET_CREATE: 'assets.create',
    ASSET_UPDATE: 'assets.update',
    ASSET_DELETE: 'assets.delete',
    USER_READ: 'users.read',
    USER_CREATE: 'users.create',
    USER_UPDATE: 'users.update',
    USER_DELETE: 'users.delete',
    SYSTEM_READ: 'system.read',
    STATISTICS_READ: 'statistics.read'
  },

  // Role-based permissions mapping (using standardized dot notation)
  ROLE_PERMISSIONS: {
    superadmin: [
      // User management
      'users.create', 'users.read', 'users.update', 'users.delete', 'users.assign_roles', 'users.reset_password',

      // Asset management
      'assets.create', 'assets.read', 'assets.update', 'assets.delete', 'assets.assign', 'assets.transfer', 'assets.maintenance', 'assets.retire',

      // Master data - Generic
      'masters.read', 'masters.create', 'masters.update', 'masters.delete', 'masters.write',

      // Master data - Specific resources
      'masters.oem.manage', 'masters.categories.manage', 'masters.subcategories.manage',
      'masters.products.manage', 'masters.locations.manage', 'masters.location-types.manage',
      'masters.clients.manage', 'masters.product-types.manage', 'masters.product-series.manage',
      'masters.pincode-lookup.manage', 'manage_field_templates',

      // Department management
      'departments.create', 'departments.read', 'departments.update', 'departments.delete', 'departments.manage_hierarchy',

      // Ticket management
      'tickets.create', 'tickets.read', 'tickets.update', 'tickets.delete', 'tickets.assign', 'tickets.close',

      // Delivery ticket management
      'delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete',

      // Reporting
      'reports.view', 'reports.export', 'reports.dashboard', 'reports.analytics',

      // System administration
      'system.create', 'system.read', 'system.update', 'system.settings', 'system.logs', 'system.backup', 'system.maintenance',

      // Permission control
      'permission-control.read', 'permission-control.create', 'permission-control.update', 'permission-control.delete',

      // Statistics
      'statistics.read'
    ],
    admin: [
      // User management (no delete)
      'users.create', 'users.read', 'users.update', 'users.assign_roles', 'users.reset_password',

      // Asset management
      'assets.create', 'assets.read', 'assets.update', 'assets.delete', 'assets.assign', 'assets.transfer', 'assets.maintenance',

      // Master data - Generic
      'masters.read', 'masters.create', 'masters.update', 'masters.delete', 'masters.write',

      // Master data - Specific resources
      'masters.oem.manage', 'masters.categories.manage', 'masters.subcategories.manage',
      'masters.products.manage', 'masters.locations.manage', 'masters.location-types.manage',
      'masters.clients.manage', 'masters.product-types.manage', 'masters.product-series.manage',
      'masters.pincode-lookup.manage',

      // Department management
      'departments.create', 'departments.read', 'departments.update', 'departments.delete',

      // Ticket management
      'tickets.create', 'tickets.read', 'tickets.update', 'tickets.assign', 'tickets.close',

      // Delivery ticket management
      'delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete',

      // Reporting
      'reports.view', 'reports.export', 'reports.dashboard',

      // System administration (limited)
      'system.create', 'system.read', 'system.update',

      // Permission control (limited)
      'permission-control.read', 'permission-control.create', 'permission-control.update',

      // Statistics
      'statistics.read'
    ],
    it_head: [
      // User management (read only)
      'users.read', 'users.update',

      // Asset management
      'assets.create', 'assets.read', 'assets.update', 'assets.assign', 'assets.transfer', 'assets.maintenance',

      // Master data
      'masters.read', 'masters.create', 'masters.update',
      'masters.oem.manage', 'masters.categories.manage', 'masters.products.manage',
      'masters.product-types.manage', 'masters.product-series.manage',

      // Department management (read only)
      'departments.read',

      // Ticket management
      'tickets.create', 'tickets.read', 'tickets.update', 'tickets.assign',

      // Delivery ticket management
      'delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete',

      // Reporting
      'reports.view', 'reports.export', 'reports.dashboard',

      // Statistics
      'statistics.read'
    ],
    department_head: [
      // User management (read only)
      'users.read', 'users.update',

      // Asset management (limited)
      'assets.read', 'assets.assign', 'assets.transfer',

      // Master data (read only)
      'masters.read',

      // Department management
      'departments.read', 'departments.update',

      // Ticket management
      'tickets.create', 'tickets.read', 'tickets.update', 'tickets.assign',

      // Reporting
      'reports.view', 'reports.dashboard'
    ],
    coordinator: [
       // User management
      'users.read',
      'users.create',
      'users.update',
      'users.delete',

      // Asset management
      'assets.create', 'assets.read', 'assets.update', 'assets.assign', 'assets.maintenance',

      // Master data (read only)
      'masters.read',

      // Department management (read only)
      'departments.read',

      // Ticket management
      'tickets.create', 'tickets.read', 'tickets.update',

      // Delivery ticket management
      'delivery-tickets.create', 'delivery-tickets.read', 'delivery-tickets.update', 'delivery-tickets.delete',

      // Reporting
      'reports.view'
    ],
    department_coordinator: [
      // User management (read only)
      'users.read',

      // Asset management (limited)
      'assets.read', 'assets.assign', 'assets.maintenance',

      // Master data (read only)
      'masters.read',

      // Ticket management
      'tickets.create', 'tickets.read', 'tickets.update',

      // Reporting
      'reports.view'
    ],
    engineer: [
      // Ticket management
      'tickets.read', 'tickets.update',

      // Delivery ticket management (read and update only)
      'delivery-tickets.read', 'delivery-tickets.update',

      // Asset management (read and maintenance only)
      'assets.read', 'assets.maintenance',

      // Master data (read only)
      'masters.read',

      // Reporting
      'reports.view'
    ],
    employee: [
      // Asset management (read only)
      'assets.read',

      // Master data (read only)
      'masters.read',

      // Ticket management (limited)
      'tickets.create', 'tickets.read',

      // Reporting
      'reports.view'
    ]
  }
};
