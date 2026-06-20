const { validationResult } = require('express-validator');
const { sendValidationError } = require('../utils/response');

const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = source === 'body' ? req.body : 
                 source === 'params' ? req.params : 
                 source === 'query' ? req.query : req[source];

    console.log('REQUEST BODY:', req.body)
console.log('allow_multi_assets:', req.body.allow_multi_assets)
console.log('TYPE:', typeof req.body.allow_multi_assets)

    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    console.log('VALIDATED VALUE:', value);
console.log('VALIDATION ERROR:', error);

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, ''),
        value: detail.context.value
      }));

      return sendValidationError(res, errors, 'Validation failed');
    }

    // Replace the original data with validated/sanitized data
    if (source === 'body') req.body = value;
    else if (source === 'params') req.params = value;
    else if (source === 'query') req.query = value;
    else req[source] = value;

    next();
  };
};

const validateBody = (schema) => validate(schema, 'body');
const validateParams = (schema) => validate(schema, 'params');
const validateQuery = (schema) => validate(schema, 'query');

// Custom validation middleware for pagination
const validatePagination = (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const sortBy = req.query.sortBy || 'created_at';
  const sortOrder = req.query.sortOrder || 'desc';

  // Validate pagination parameters
  if (page < 1) {
    return sendValidationError(res, [{ field: 'page', message: 'Page must be greater than 0' }]);
  }

  if (limit < 1 || limit > 5000) {
    return sendValidationError(res, [{ field: 'limit', message: 'Limit must be between 1 and 5000' }]);
  }

  if (!['asc', 'desc'].includes(sortOrder.toLowerCase())) {
    return sendValidationError(res, [{ field: 'sortOrder', message: 'Sort order must be either asc or desc' }]);
  }

  // Set validated pagination data
  req.pagination = {
    page,
    limit,
    offset: (page - 1) * limit,
    sortBy,
    sortOrder: sortOrder.toLowerCase()
  };

  next();
};

// Validation for file uploads
const validateFileUpload = (options = {}) => {
  const {
    maxSize = 10 * 1024 * 1024, // 10MB
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    required = false
  } = options;

  return (req, res, next) => {
    const file = req.file;

    // Check if file is required
    if (required && !file) {
      return sendValidationError(res, [{ field: 'file', message: 'File is required' }]);
    }

    // If file is not provided and not required, continue
    if (!file && !required) {
      return next();
    }

    // Validate file size
    if (file.size > maxSize) {
      return sendValidationError(res, [{
        field: 'file',
        message: `File size must be less than ${Math.round(maxSize / (1024 * 1024))}MB`
      }]);
    }

    // Validate file type
    if (!allowedTypes.includes(file.mimetype)) {
      return sendValidationError(res, [{
        field: 'file',
        message: `File type not allowed. Allowed types: ${allowedTypes.join(', ')}`
      }]);
    }

    next();
  };
};

// Custom validation for search queries
const validateSearch = (req, res, next) => {
  const { search, searchFields } = req.query;

  if (search) {
    // Validate search query length
    if (search.length < 2) {
      return sendValidationError(res, [{
        field: 'search',
        message: 'Search query must be at least 2 characters long'
      }]);
    }

    if (search.length > 100) {
      return sendValidationError(res, [{
        field: 'search',
        message: 'Search query must be less than 100 characters'
      }]);
    }

    // Sanitize search query (basic XSS protection)
    req.query.search = search.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }

  if (searchFields && typeof searchFields === 'string') {
    // Convert comma-separated string to array
    req.query.searchFields = searchFields.split(',').map(field => field.trim());
  }

  next();
};

// Validation for date ranges
const validateDateRange = (req, res, next) => {
  const { startDate, endDate } = req.query;

  if (startDate || endDate) {
    const errors = [];

    if (startDate && !isValidDate(startDate)) {
      errors.push({ field: 'startDate', message: 'Invalid start date format. Use YYYY-MM-DD' });
    }

    if (endDate && !isValidDate(endDate)) {
      errors.push({ field: 'endDate', message: 'Invalid end date format. Use YYYY-MM-DD' });
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errors.push({ field: 'dateRange', message: 'Start date must be before end date' });
    }

    if (errors.length > 0) {
      return sendValidationError(res, errors);
    }
  }

  next();
};

// Helper function to validate date format
const isValidDate = (dateString) => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
};

// Validation for UUID parameters
const validateUUID = (paramName) => {
  return (req, res, next) => {
    const uuid = req.params[paramName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(uuid)) {
      return sendValidationError(res, [{
        field: paramName,
        message: 'Invalid UUID format'
      }]);
    }

    next();
  };
};

// Middleware to check express-validator results
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));

    return sendValidationError(res, formattedErrors, 'Validation failed');
  }

  next();
};

module.exports = {
  validate,
  validateBody,
  validateParams,
  validateQuery,
  validatePagination,
  validateFileUpload,
  validateSearch,
  validateDateRange,
  validateUUID,
  validateRequest
};
