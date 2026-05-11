const cors = require('cors');
const appConfig = require('../config/app');

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = appConfig.cors.origin;
    
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (
  allowedOrigins.includes(origin) ||
  origin.includes('localhost') ||
  origin.includes('127.0.0.1') ||
  origin.includes('172.16.150.80')
) {
  return callback(null, true);
}
    
    // Allow localhost in development/testing
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  
  methods: appConfig.cors.methods,
  allowedHeaders: appConfig.cors.allowedHeaders,
  credentials: appConfig.cors.credentials,
  
  // How long the browser should cache preflight responses
  maxAge: 86400, // 24 hours
  
  // Whether to pass the CORS preflight response to the next handler
  preflightContinue: false,
  
  // Provides a status code to use for successful OPTIONS requests
  optionsSuccessStatus: 200
};

// Enhanced CORS middleware with custom handling
const corsMiddleware = cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = appConfig.cors.origin;

    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') return callback(null, true);

    // Check if origin is in allowed list
    if (
  allowedOrigins.includes(origin) ||
  origin.includes('localhost') ||
  origin.includes('127.0.0.1') ||
  origin.includes('172.16.150.80')
) {
  return callback(null, true);
}

    callback(new Error('Not allowed by CORS'));
  },
  methods: appConfig.cors.methods,
  allowedHeaders: appConfig.cors.allowedHeaders,
  credentials: appConfig.cors.credentials,
  optionsSuccessStatus: 200,
  maxAge: 86400
});


// CORS middleware for specific routes
const corsForRoute = (origins = []) => {
  const routeCorsOptions = {
    ...corsOptions,
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      
     if (
        origins.includes(origin) ||
        process.env.NODE_ENV === 'development' ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('172.16.150.80')
      ) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS for this route'));
    }  };
  
  return cors(routeCorsOptions);
};

// CORS middleware for public routes (more permissive)
const publicCors = cors({
  origin: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Accept'],
  credentials: false,
  maxAge: 3600
});

// CORS middleware for admin routes (more restrictive)
const adminCors = cors({
  origin: function (origin, callback) {
    const adminAllowedOrigins = process.env.ADMIN_ALLOWED_ORIGINS?.split(',') || [];
    
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    if (adminAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Admin access not allowed from this origin'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: appConfig.cors.allowedHeaders,
  credentials: true,
  maxAge: 3600
});

module.exports = {
  corsMiddleware,
  corsForRoute,
  publicCors,
  adminCors,
  corsOptions
};
