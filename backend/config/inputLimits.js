module.exports = {
  // ===== AUTHENTICATION =====
  auth: {
    username: {
      minLength: 3,
      max: 30,
      pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/,
      description:
        "Username must be 3-30 characters (letters, numbers, dots, underscores, hyphens). Must start and end with alphanumeric",
    },
    email: {
      minLength: 5,
      max: 100,
      pattern: /^[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/,
      description: "Valid email address required (e.g., user@example.com)",
    },
    password: {
      minLength: 8,
      max: 128,
      pattern:
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+={}\[\]|:;"'<>,.~`-])[A-Za-z\d@$!%*?&#^()_+={}\[\]|:;"'<>,.~`-]{8,}$/,
      description:
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
    },
    fullname: {
      minLength: 2,
      max: 100,
      pattern: /^[a-zA-ZÀ-ÿ\u0100-\u017F\u0180-\u024F\s'.,-]+$/,
      description:
        "Full name must be 2-100 characters (letters including accents, spaces, hyphens, apostrophes, dots, commas)",
    },
  },

  // ===== QUESTIONS =====
  question: {
    text: {
      minLength: 10,
      max: 5000,
      description: "Question text must be 10-5000 characters",
    },
    option: {
      minLength: 1,
      max: 500,
      description: "Each option must be 1-500 characters",
    },
    explanation: {
      minLength: 0,
      max: 2000,
      description: "Explanation must be under 2000 characters",
    },
    topic: {
      minLength: 3,
      max: 50,
      pattern: /^[a-zA-Z0-9-]{3,50}$/,
      description: "Topic must be 3-50 characters (letters, numbers, hyphens only)",
    },
  },

  // ===== CONTACT FORM =====
  contact: {
    name: {
      minLength: 2,
      max: 100,
      description: "Name must be 2-100 characters",
    },
    email: {
      minLength: 5,
      max: 100,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      description: "Valid email required",
    },
    subject: {
      minLength: 5,
      max: 200,
      description: "Subject must be 5-200 characters",
    },
    message: {
      minLength: 20,
      max: 5000,
      description: "Message must be 20-5000 characters",
    },
  },

  // ===== FILE UPLOADS =====
  file: {
    name: {
      minLength: 3,
      max: 255,
      pattern: /^[a-zA-Z0-9\s._-]+\.[a-zA-Z0-9]{2,5}$/,
      description: "Filename must be 3-255 characters with valid extension",
    },
    maxSizeMB: 50,
    allowedExtensions: [
      ".pdf",
      ".docx",
      ".pptx",
      ".ppt",
      ".txt",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".heic",
      ".heif",
    ],
    allowedMimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
      "text/plain",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
  },

  // ===== ADMIN OPERATIONS =====
  adminLength: {
    bulkOperationMaxItems: 100,
    adminLengthNotes: {
      minLength: 0,
      max: 5000,
      description: "AdminLength notes must be under 5000 characters",
    },
    reason: {
      minLength: 10,
      max: 1000,
      description: "Reason must be 10-1000 characters",
    },
  },

  // ===== ORG / SCHOOL REGISTRATION =====
  // Used by validateOrgRegister (school IT admin / owner signup)
  org: {
    orgName: {
      minLength: 2,
      maxLength: 120,
      // Allows letters (inc. accented), numbers, spaces, hyphens, apostrophes, dots, commas
      pattern: /^[a-zA-ZÀ-ÿ\u0100-\u017F\u0180-\u024F0-9\s'.,-]+$/,
      description:
        "School name must be 2-120 characters (letters, numbers, spaces, hyphens, dots)",
    },
    contactName: {
      minLength: 2,
      maxLength: 100,
      // Same as auth.fullname
      pattern: /^[a-zA-ZÀ-ÿ\u0100-\u017F\u0180-\u024F\s'.,-]+$/,
      description: "Contact name must be 2-100 characters",
    },
    schoolType: {
      // Allowlist kept in sync with SCHOOL_TYPES in onboarding.js
      enum: ["primary", "secondary", "combined", "tertiary", "other"],
      description: "School type must be one of: primary, secondary, combined, tertiary, other",
    },
    estimatedEnrollment: {
      min: 1,
      max: 10000,
      description: "Estimated enrollment must be between 1 and 10,000",
    },
  },

  // ===== GENERAL =====
  general: {
    arrayMaxLength: 1000,
    objectMaxKeys: 100,
    stringDefaultMax: 10000,
    numberMax: Number.MAX_SAFE_INTEGER,
  },
};
