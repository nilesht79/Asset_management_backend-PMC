const Joi = require('joi');
const { USER_ROLES, TICKET_PRIORITY, REQUISITION_STATUS } = require('./constants');

const validators = {
  // Common validations
  id: Joi.string().uuid().required(),
  optionalId: Joi.string().uuid().optional(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]+$')).required(),
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(1000).optional(),
  status: Joi.string().valid('active', 'inactive').default('active'),
  
  // Pagination
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc')
  },

  // User validations
  user: {
    create: Joi.object({
      first_name: Joi.string().min(2).max(50).required(),
      last_name: Joi.string().min(2).max(50).required(),
      email: Joi.string().email({ tlds: { allow: false } }).optional().allow('', null), // Optional - will auto-generate if not provided
      password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]+$')).optional().allow('', null), // Optional - will auto-generate if not provided
      role: Joi.string().valid(...Object.values(USER_ROLES)).required(),
      department_id: Joi.string().uuid().optional().allow(null),
      location_id: Joi.string().uuid().optional().allow(null),
      employee_id: Joi.string().max(20).optional(),
      designation: Joi.string().max(100).optional().allow('', null),
      room_no: Joi.string().max(50).optional().allow('', null),
      contact_number: Joi.string().max(15).pattern(/^[0-9]+$/).optional().allow('', null),
      is_active: Joi.boolean().default(true),
      is_vip: Joi.boolean().default(false),
      allow_multi_assets: Joi.boolean().default(false)
    }),

    update: Joi.object({
      first_name: Joi.string().min(2).max(50).optional(),
      last_name: Joi.string().min(2).max(50).optional(),
      email: Joi.string().email({ tlds: { allow: false } }).optional(),
      role: Joi.string().valid(...Object.values(USER_ROLES)).optional(),
      department_id: Joi.string().uuid().optional().allow(null),
      location_id: Joi.string().uuid().optional().allow(null),
      employee_id: Joi.string().max(20).optional(),
      designation: Joi.string().max(100).optional().allow('', null),
      room_no: Joi.string().max(50).optional().allow('', null),
      contact_number: Joi.string().max(15).pattern(/^[0-9]+$/).optional().allow('', null),
      is_active: Joi.boolean().optional(),
      is_vip: Joi.boolean().optional(),
      allow_multi_assets: Joi.boolean().optional()
    }),
    
    changePassword: Joi.object({
      current_password: Joi.string().required(),
      new_password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]')).required(),
      confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
    })
  },

  // Department validations
  department: {
    create: Joi.object({
      name: Joi.string().min(2).max(100).required(),
      description: Joi.string().max(500).optional(),
      contact_person_id: Joi.string().uuid().optional().allow(null, '')
    }),
    
    update: Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      description: Joi.string().max(500).optional(),
      contact_person_id: Joi.string().uuid().optional().allow(null, '')
    })
  },

  // Master data validations
  oem: {
    create: Joi.object({
      name: Joi.string().min(2).max(100).required(),
      code: Joi.string().min(2).max(20).required(),
      description: Joi.string().max(500).optional().allow(null, ''),
      contact_person: Joi.string().max(100).optional().allow(null, ''),
      email: Joi.string().email().optional().allow(null, ''),
      phone: Joi.string().pattern(new RegExp('^[+]?[1-9][\\d]{0,15}$')).optional().allow(null, ''),
      website: Joi.string().uri().optional().allow(null, ''),
      address: Joi.string().max(500).optional().allow(null, ''),
      is_active: Joi.boolean().default(true)
    }),

    update: Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      code: Joi.string().min(2).max(20).optional(),
      description: Joi.string().max(500).optional().allow(null, ''),
      contact_person: Joi.string().max(100).optional().allow(null, ''),
      email: Joi.string().email().optional().allow(null, ''),
      phone: Joi.string().pattern(new RegExp('^[+]?[1-9][\\d]{0,15}$')).optional().allow(null, ''),
      website: Joi.string().uri().optional().allow(null, ''),
      address: Joi.string().max(500).optional().allow(null, ''),
      is_active: Joi.boolean().optional()
    })
  },

  vendor: {
    create: Joi.object({
      name: Joi.string().min(2).max(255).required(),
      code: Joi.string().min(2).max(50).optional().allow(null, ''),
      is_active: Joi.boolean().default(true)
    }),

    update: Joi.object({
      name: Joi.string().min(2).max(255).optional(),
      code: Joi.string().min(2).max(50).optional().allow(null, ''),
      is_active: Joi.boolean().optional()
    })
  },

  category: {
    create: Joi.object({
      name: Joi.string().min(2).max(100).required(),
      description: Joi.string().max(500).optional(),
      parent_category_id: Joi.string().uuid().optional().allow(null),
      is_active: Joi.boolean().default(true)
    }),
    
    update: Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      description: Joi.string().max(500).optional(),
      parent_category_id: Joi.string().uuid().optional().allow(null),
      is_active: Joi.boolean().optional()
    })
  },

  productType: {
    create: Joi.object({
      name: Joi.string().min(2).max(100).required(),
      description: Joi.string().max(500).optional(),
      is_active: Joi.boolean().default(true)
    }),
    
    update: Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      description: Joi.string().max(500).optional(),
      is_active: Joi.boolean().optional()
    })
  },

  product: {
    create: Joi.object({
      name: Joi.string().min(2).max(200).required(),
      description: Joi.string().max(1000).optional(),
      model: Joi.string().max(100).optional(),
      type_id: Joi.string().uuid().optional(),
      category_id: Joi.string().uuid().required(),
      subcategory_id: Joi.string().uuid().optional(),
      series_id: Joi.string().uuid().optional(),
      oem_id: Joi.string().uuid().required(),
      specifications: Joi.string().max(5000).allow(null, '').optional(),
      warranty_period: Joi.number().integer().positive().optional(),
      capacity_value: Joi.number().positive().allow(null).optional(),
      capacity_unit: Joi.string().max(20).allow(null, '').optional(),
      speed_value: Joi.number().positive().allow(null).optional(),
      speed_unit: Joi.string().max(20).allow(null, '').optional(),
      interface_type: Joi.string().max(50).allow(null, '').optional(),
      form_factor: Joi.string().max(50).allow(null, '').optional(),
      software_type: Joi.string().max(50).valid('operating_system', 'application', 'utility', 'driver').allow(null).optional(),
      is_active: Joi.boolean().default(true)
    }),

    update: Joi.object({
      name: Joi.string().min(2).max(200).optional(),
      description: Joi.string().max(1000).allow(null, '').optional(),
      model: Joi.string().max(100).allow(null, '').optional(),
      type_id: Joi.string().uuid().allow(null).optional(),
      category_id: Joi.string().uuid().allow(null).optional(),
      subcategory_id: Joi.string().uuid().allow(null).optional(),
      series_id: Joi.string().uuid().allow(null).optional(),
      oem_id: Joi.string().uuid().allow(null).optional(),
      specifications: Joi.string().max(5000).allow(null, '').optional(),
      warranty_period: Joi.number().integer().positive().allow(null).optional(),
      capacity_value: Joi.number().positive().allow(null).optional(),
      capacity_unit: Joi.string().max(20).allow(null, '').optional(),
      speed_value: Joi.number().positive().allow(null).optional(),
      speed_unit: Joi.string().max(20).allow(null, '').optional(),
      interface_type: Joi.string().max(50).allow(null, '').optional(),
      form_factor: Joi.string().max(50).allow(null, '').optional(),
      software_type: Joi.string().max(50).valid('operating_system', 'application', 'utility', 'driver').allow(null).optional(),
      is_active: Joi.boolean().optional()
    })
  },

  productSeries: {
    create: Joi.object({
      name: Joi.string().min(2).max(255).required(),
      description: Joi.string().max(1000).optional(),
      oem_id: Joi.string().uuid().required(),
      category_id: Joi.string().uuid().required(),
      sub_category_id: Joi.string().uuid().required()
    }),
    
    update: Joi.object({
      name: Joi.string().min(2).max(255).optional(),
      description: Joi.string().max(1000).optional(),
      oem_id: Joi.string().uuid().optional(),
      category_id: Joi.string().uuid().optional(),
      sub_category_id: Joi.string().uuid().optional()
    })
  },

  location: {
    create: Joi.object({
      name: Joi.string().min(2).max(100).required(),
      address: Joi.string().max(500).required(),
      client_id: Joi.string().uuid().required(),
      location_type_id: Joi.string().uuid().required(),
      pincode: Joi.string().pattern(new RegExp('^\\d{6}$')).required(),
      state_name: Joi.string().min(2).max(100).required(),
      city_name: Joi.string().min(2).max(100).required(),
      area_name: Joi.string().max(200).optional().allow(null, ''),
      contact_person: Joi.string().min(2).max(100).required(),
      contact_email: Joi.string().email().required(),
      contact_phone: Joi.string().pattern(new RegExp('^[+]?[1-9][\\d]{0,15}$')).optional(),
      parent_location_id: Joi.string().uuid().optional().allow(null),
      is_active: Joi.boolean().default(true)
    }),
    
    update: Joi.object({
      name: Joi.string().min(2).max(100).optional(),
      address: Joi.string().max(500).optional(),
      client_id: Joi.string().uuid().optional(),
      location_type_id: Joi.string().uuid().optional(),
      pincode: Joi.string().pattern(new RegExp('^\\d{6}$')).optional(),
      state_name: Joi.string().min(2).max(100).optional(),
      city_name: Joi.string().min(2).max(100).optional(),
      area_name: Joi.string().max(200).optional().allow(null, ''),
      contact_person: Joi.string().min(2).max(100).optional(),
      contact_email: Joi.string().email().optional(),
      contact_phone: Joi.string().pattern(new RegExp('^[+]?[1-9][\\d]{0,15}$')).optional(),
      parent_location_id: Joi.string().uuid().optional().allow(null),
      is_active: Joi.boolean().optional()
    })
  },

  // Master data validations for new structure
  locationType: {
    create: Joi.object({
      location_type: Joi.string().min(2).max(100).required(),
      description: Joi.string().max(500).optional().allow(null, ''),
      is_active: Joi.boolean().default(true)
    }),

    update: Joi.object({
      location_type: Joi.string().min(2).max(100).optional(),
      description: Joi.string().max(500).optional().allow(null, ''),
      is_active: Joi.boolean().optional()
    })
  },

  state: {
    create: Joi.object({
      state_name: Joi.string().min(2).max(100).required(),
      country: Joi.string().min(2).max(100).default('India'),
      is_active: Joi.boolean().default(true)
    }),
    
    update: Joi.object({
      state_name: Joi.string().min(2).max(100).optional(),
      country: Joi.string().min(2).max(100).optional(),
      is_active: Joi.boolean().optional()
    })
  },

  city: {
    create: Joi.object({
      city_name: Joi.string().min(2).max(100).required(),
      state_id: Joi.string().uuid().required(),
      is_active: Joi.boolean().default(true)
    }),
    
    update: Joi.object({
      city_name: Joi.string().min(2).max(100).optional(),
      state_id: Joi.string().uuid().optional(),
      is_active: Joi.boolean().optional()
    })
  },

  pincode: {
    create: Joi.object({
      pincode: Joi.string().min(4).max(10).required(),
      state_id: Joi.string().uuid().required(),
      city_id: Joi.string().uuid().required(),
      is_active: Joi.boolean().default(true)
    }),
    
    update: Joi.object({
      pincode: Joi.string().min(4).max(10).optional(),
      state_id: Joi.string().uuid().optional(),
      city_id: Joi.string().uuid().optional(),
      is_active: Joi.boolean().optional()
    })
  },

  client: {
    create: Joi.object({
      client_name: Joi.string().min(2).max(255).required(),
      contact_person: Joi.string().min(2).max(100).optional(),
      contact_email: Joi.string().email().optional(),
      contact_phone: Joi.string().pattern(new RegExp('^[+]?[1-9][\\d]{0,15}$')).optional(),
      address: Joi.string().max(500).optional(),
      is_active: Joi.boolean().default(true)
    }),
    
    update: Joi.object({
      client_name: Joi.string().min(2).max(255).optional(),
      contact_person: Joi.string().min(2).max(100).optional(),
      contact_email: Joi.string().email().optional(),
      contact_phone: Joi.string().pattern(new RegExp('^[+]?[1-9][\\d]{0,15}$')).optional(),
      address: Joi.string().max(500).optional(),
      is_active: Joi.boolean().optional()
    })
  },

  // Auth validations
  auth: {
    login: Joi.object({
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      password: Joi.string().required()
    }),

    roleBasedLogin: Joi.object({
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      password: Joi.string().required(),
      role: Joi.string().valid(...Object.values(USER_ROLES)).optional(),
      loginType: Joi.string().valid('role-based', 'generic').optional()
    }),
    
    register: Joi.object({
      firstName: Joi.string().min(2).max(50).required(),
      lastName: Joi.string().min(2).max(50).required(),
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]+$')).required(),
      confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
      role: Joi.string().valid('admin', 'superadmin').required(),
      registrationType: Joi.string().valid('self-registration').optional()
    }),

    adminRegister: Joi.object({
      firstName: Joi.string().min(2).max(50).required(),
      lastName: Joi.string().min(2).max(50).required(),
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]+$')).required(),
      confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
      registrationType: Joi.string().valid('self-registration').optional()
    }),

    superadminRegister: Joi.object({
      firstName: Joi.string().min(2).max(50).required(),
      lastName: Joi.string().min(2).max(50).required(),
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      password: Joi.string().min(12).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]')).required(),
      confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
      registrationType: Joi.string().valid('self-registration').optional()
    }),

    refreshToken: Joi.object({
      refresh_token: Joi.string().required()
    }),

    forgotPassword: Joi.object({
      email: Joi.string().email({ tlds: { allow: false } }).required()
    }),
    
    resetPassword: Joi.object({
      token: Joi.string().required(),
      password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]+$')).required(),
      confirm_password: Joi.string().valid(Joi.ref('password')).required()
    }),

    // OAuth 2.0 validations
    oauthLogin: Joi.object({
      employeeId: Joi.string().min(1).max(20).required(),
      password: Joi.string().required(),
      client_id: Joi.string().required(),
      client_secret: Joi.string().optional(),
      scope: Joi.string().default('read write'),
      role: Joi.string().valid(...Object.values(USER_ROLES)).optional()
    }),

    oauthRefresh: Joi.object({
      client_id: Joi.string().required(),
      client_secret: Joi.string().optional()
    }),

    oauthClient: Joi.object({
      clientId: Joi.string().min(3).max(100).required(),
      clientSecret: Joi.string().min(8).required(),
      name: Joi.string().min(3).max(200).required(),
      grants: Joi.string().default('authorization_code,refresh_token'),
      redirectUris: Joi.string().optional(),
      scope: Joi.string().default('read'),
      isConfidential: Joi.boolean().default(true)
    })
  },

  // Asset validations
  asset: {
    create: Joi.object({
      asset_tag: Joi.string().min(1).max(50).optional(), // CHANGED: Optional - auto-generated from product
      serial_number: Joi.string().min(1).max(100).required(),
      product_id: Joi.string().uuid().required(),
      assigned_to: Joi.string().uuid().optional().allow(null),
      location_id: Joi.string().uuid().optional().allow(null),
      department_id: Joi.string().uuid().optional().allow(null),
      status: Joi.string().valid('available', 'assigned', 'in_use', 'under_repair', 'disposed', 'maintenance', 'not found').default('available'),
      condition_status: Joi.string().valid('excellent', 'good', 'fair', 'needs_repair', 'poor').default('good'),
      importance: Joi.string().valid('critical', 'high', 'medium', 'low').default('medium'),
      purchase_date: Joi.date().optional().allow(null),
      warranty_start_date: Joi.date().optional().allow(null),
      warranty_end_date: Joi.date().optional().allow(null),
      eol_date: Joi.date().optional().allow(null),
      eos_date: Joi.date().optional().allow(null),
      purchase_cost: Joi.number().positive().precision(2).optional().allow(null),
      vendor_id: Joi.string().uuid().optional().allow(null),
      invoice_number: Joi.string().max(100).optional().allow(null, ''),
      notes: Joi.string().max(1000).optional().allow(null, ''),
      is_active: Joi.boolean().default(true),
      // New fields for component hierarchy
      asset_type: Joi.string().valid('standalone', 'parent', 'component').default('standalone'),
      parent_asset_id: Joi.string().uuid().optional().allow(null),
      installation_date: Joi.date().optional().allow(null),
      installation_notes: Joi.string().max(1000).optional().allow(null),
      installed_by: Joi.string().uuid().optional().allow(null),
      // Software installations
      software_installations: Joi.array().items(
        Joi.object({
          software_product_id: Joi.string().uuid().required(),
          software_type: Joi.string().valid('operating_system', 'application', 'utility', 'driver').optional(),
          license_key: Joi.string().max(500).optional().allow(null, ''),
          license_type: Joi.string().valid('oem', 'retail', 'volume', 'subscription').optional(),
          license_id: Joi.string().uuid().optional().allow(null),
          installation_date: Joi.date().optional().allow(null),
          notes: Joi.string().max(1000).optional().allow(null, '')
        })
      ).optional()
    }),

    update: Joi.object({
      asset_tag: Joi.string().min(1).max(50).optional(),
      serial_number: Joi.string().min(1).max(100).optional().allow(null),
      product_id: Joi.string().uuid().optional(),
      assigned_to: Joi.string().uuid().optional().allow(null),
      location_id: Joi.string().uuid().optional().allow(null),
      department_id: Joi.string().uuid().optional().allow(null),
      status: Joi.string().valid('available', 'assigned', 'in_use', 'under_repair', 'disposed', 'maintenance', 'not found').optional(),
      condition_status: Joi.string().valid('excellent', 'good', 'fair', 'needs_repair', 'poor').optional(),
      importance: Joi.string().valid('critical', 'high', 'medium', 'low').optional(),
      purchase_date: Joi.date().optional().allow(null),
      warranty_start_date: Joi.date().optional().allow(null),
      warranty_end_date: Joi.date().optional().allow(null),
      eol_date: Joi.date().optional().allow(null),
      eos_date: Joi.date().optional().allow(null),
      purchase_cost: Joi.number().positive().precision(2).optional().allow(null),
      vendor_id: Joi.string().uuid().optional().allow(null),
      invoice_number: Joi.string().max(100).optional().allow(null, ''),
      notes: Joi.string().max(1000).optional().allow(null, ''),
      is_active: Joi.boolean().optional(),
      // New fields for component hierarchy
      asset_type: Joi.string().valid('standalone', 'parent', 'component').optional(),
      parent_asset_id: Joi.string().uuid().optional().allow(null),
      installation_date: Joi.date().optional().allow(null),
      installation_notes: Joi.string().max(1000).optional().allow(null),
      installed_by: Joi.string().uuid().optional().allow(null),
      // Software installations
      software_installations: Joi.array().items(
        Joi.object({
          software_product_id: Joi.string().uuid().required(),
          software_type: Joi.string().valid('operating_system', 'application', 'utility', 'driver').optional(),
          license_key: Joi.string().max(500).optional().allow(null, ''),
          license_type: Joi.string().valid('oem', 'retail', 'volume', 'subscription').optional(),
          license_id: Joi.string().uuid().optional().allow(null),
          installation_date: Joi.date().optional().allow(null),
          notes: Joi.string().max(1000).optional().allow(null, '')
        })
      ).optional()
    }),

    // New validator for component installation
    installComponent: Joi.object({
      component_asset_id: Joi.string().uuid().required(),
      installation_notes: Joi.string().max(1000).optional().allow(null, ''),
      installed_by: Joi.string().uuid().optional().allow(null)
    }),

    // New validator for component removal
    removeComponent: Joi.object({
      removal_notes: Joi.string().max(1000).optional().allow(null, '')
    })
  },

  // Component Field Template validations
  componentFieldTemplate: {
    create: Joi.object({
      product_type_id: Joi.string().uuid().required(),
      field_name: Joi.string().max(50).required(),
      display_label: Joi.string().max(100).required(),
      field_type: Joi.string().valid('text', 'number_with_unit', 'select', 'multiselect').required(),
      is_required: Joi.boolean().default(false),
      display_order: Joi.number().integer().min(1).required(),
      placeholder_text: Joi.string().max(100).allow(null, '').optional(),
      help_text: Joi.string().max(200).allow(null, '').optional(),
      min_value: Joi.number().allow(null).optional(),
      max_value: Joi.number().allow(null).optional(),
    }),

    update: Joi.object({
      product_type_id: Joi.string().uuid().optional(),
      field_name: Joi.string().max(50).optional(),
      display_label: Joi.string().max(100).optional(),
      field_type: Joi.string().valid('text', 'number_with_unit', 'select', 'multiselect').optional(),
      is_required: Joi.boolean().optional(),
      display_order: Joi.number().integer().min(1).optional(),
      placeholder_text: Joi.string().max(100).allow(null, '').optional(),
      help_text: Joi.string().max(200).allow(null, '').optional(),
      min_value: Joi.number().allow(null).optional(),
      max_value: Joi.number().allow(null).optional(),
    })
  },

  // Component Field Option validations
  componentFieldOption: {
    create: Joi.object({
      field_template_id: Joi.string().uuid().required(),
      option_value: Joi.string().max(50).required(),
      option_label: Joi.string().max(100).required(),
      is_default: Joi.boolean().default(false),
      display_order: Joi.number().integer().min(1).required(),
    }),

    update: Joi.object({
      field_template_id: Joi.string().uuid().optional(),
      option_value: Joi.string().max(50).optional(),
      option_label: Joi.string().max(100).optional(),
      is_default: Joi.boolean().optional(),
      display_order: Joi.number().integer().min(1).optional(),
    })
  },

  // Common validators for reuse
  common: {
    uuid: Joi.string().uuid(),
    email: Joi.string().email(),
    name: Joi.string().min(2).max(100),
    description: Joi.string().max(1000),
    status: Joi.boolean(),
    pagination: {
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(10),
      sortBy: Joi.string().optional(),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc')
    }
  }
};

module.exports = validators;
