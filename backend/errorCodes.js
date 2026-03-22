
const ErrorCodes = {
  // Authentication Errors (401)
  UNAUTHORIZED: {
    statusCode: 401,
    message: "Authentication required",
    publicMessage: "Please log in to continue"
  },
  INVALID_TOKEN: {
    statusCode: 401,
    message: "Invalid or expired token",
    publicMessage: "Your session has expired. Please log in again"
  },
  TOKEN_VERIFICATION_FAILED: {
    statusCode: 401,
    message: "Token verification failed",
    publicMessage: "Your session has expired. Please log in again"
  },
  NO_TOKEN_PROVIDED: {
    statusCode: 401,
    message: "No authentication token provided",
    publicMessage: "Authentication required"
  },
  INVALID_CREDENTIALS: {
    statusCode: 400,
    message: "Invalid email/username or password",
    publicMessage: "Invalid email/username or password"
  },
  FIREBASE_TOKEN_INVALID: {
    statusCode: 401,
    message: "Invalid Firebase token",
    publicMessage: "Authentication failed"
  },

  // Validation Errors (400)
  INVALID_TOPIC: {
    statusCode: 400,
    message: "Invalid topic format",
    publicMessage: "Topic must be 3-10 characters (letters, numbers, hyphens only)"
  },
  INVALID_EMAIL: {
    statusCode: 400,
    message: "Invalid email format",
    publicMessage: "Please enter a valid email address"
  },
  INVALID_PASSWORD: {
    statusCode: 400,
    message: "Invalid password format",
    publicMessage: "Password must be at least 8 characters with uppercase, lowercase, and numbers"
  },
  INVALID_USERNAME: {
    statusCode: 400,
    message: "Invalid username format",
    publicMessage: "Username must be 3-20 characters (letters, numbers, underscore, hyphen only)"
  },
  INVALID_FILE_NAME: {
    statusCode: 400,
    message: "Invalid file name",
    publicMessage: "File name contains invalid characters"
  },
  NO_FILE_UPLOADED: {
    statusCode: 400,
    message: "No file uploaded",
    publicMessage: "Please select a file to upload"
  },
  FILE_TOO_LARGE: {
    statusCode: 413,
    message: "File exceeds size limit",
    publicMessage: "File size must be less than 50MB"
  },
  INVALID_JSON: {
    statusCode: 400,
    message: "Invalid JSON format",
    publicMessage: "Invalid request format"
  },
  MALFORMED_REQUEST: {
    statusCode: 400,
    message: "Malformed request",
    publicMessage: "Invalid request format"
  },
  MISSING_FIELDS: {
    statusCode: 400,
    message: "Missing required fields",
    publicMessage: "Please fill in all required fields"
  },
  INVALID_ID: {
    statusCode: 400,
    message: "Invalid ID format",
    publicMessage: "Invalid ID format"
  },
  QUESTION_TEXT_INVALID: {
    statusCode: 400,
    message: "Question text length invalid",
    publicMessage: "Question must be 10-5000 characters"
  },
  OPTIONS_INVALID: {
    statusCode: 400,
    message: "Options format invalid",
    publicMessage: "Please provide 4-6 answer options"
  },
  CORRECT_ANSWER_INVALID: {
    statusCode: 400,
    message: "Correct answer index invalid",
    publicMessage: "Invalid correct answer selection"
  },

  // Resource Not Found (404)
  USER_NOT_FOUND: {
    statusCode: 404,
    message: "User not found",
    publicMessage: "User not found"
  },
  UPLOAD_NOT_FOUND: {
    statusCode: 404,
    message: "Upload not found",
    publicMessage: "Upload not found"
  },
  QUESTIONS_NOT_FOUND: {
    statusCode: 404,
    message: "Questions not found",
    publicMessage: "No questions found for this topic"
  },
  BACKUP_NOT_FOUND: {
    statusCode: 404,
    message: "Backup not found",
    publicMessage: "No backup available"
  },

  // Conflict Errors (409)
  DUPLICATE_ENTRY: {
    statusCode: 409,
    message: "Duplicate entry",
    publicMessage: "This resource already exists"
  },
  USERNAME_TAKEN: {
    statusCode: 409,
    message: "Username already taken",
    publicMessage: "Username already taken"
  },
  EMAIL_REGISTERED: {
    statusCode: 409,
    message: "Email already registered",
    publicMessage: "Email already registered"
  },
  USER_EXISTS: {
    statusCode: 409,
    message: "User already exists",
    publicMessage: "User already exists"
  },

  // Forbidden (403)
  FORBIDDEN: {
    statusCode: 403,
    message: "Access denied",
    publicMessage: "You don't have permission to access this resource"
  },
  INSUFFICIENT_PERMISSIONS: {
    statusCode: 403,
    message: "Insufficient permissions",
    publicMessage: "You don't have permission to perform this action"
  },

  // Rate Limiting (429)
  RATE_LIMIT_EXCEEDED: {
    statusCode: 429,
    message: "Too many requests",
    publicMessage: "Too many requests. Please try again later"
  },

  // Server Errors (500)
  INTERNAL_ERROR: {
    statusCode: 500,
    message: "Internal server error",
    publicMessage: "Something went wrong. Please try again later"
  },
  DATABASE_ERROR: {
    statusCode: 500,
    message: "Database operation failed",
    publicMessage: "Something went wrong. Please try again later"
  },
  S3_UPLOAD_ERROR: {
    statusCode: 500,
    message: "File storage failed",
    publicMessage: "Failed to upload file. Please try again"
  },
  S3_DOWNLOAD_ERROR: {
    statusCode: 500,
    message: "File retrieval failed",
    publicMessage: "Failed to retrieve file. Please try again"
  },
  AI_ERROR: {
    statusCode: 500,
    message: "AI processing failed",
    publicMessage: "Failed to process request. Please try again"
  },
  CONFIG_ERROR: {
    statusCode: 500,
    message: "Server configuration error",
    publicMessage: "Server configuration error. Please contact support"
  },
  JWT_SECRET_MISSING: {
    statusCode: 500,
    message: "JWT_SECRET not configured",
    publicMessage: "Server configuration error"
  }
};

module.exports = ErrorCodes;