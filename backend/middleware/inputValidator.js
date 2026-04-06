const inputLimits = require("../config/inputLimits");
const Logger = require("../logger");
const { sanitize } = require("./sanitizer"); //  NEW IMPORT

/**
 * Validate string length
 */
function validateStringLength(value, min, max, fieldName) {
  if (typeof value !== "string") {
    return `${fieldName} must be a string`;
  }

  if (value.length < min) {
    return `${fieldName} must be at least ${min} characters`;
  }

  if (value.length > max) {
    return `${fieldName} must not exceed ${max} characters`;
  }

  return null;
}

/**
 *  NEW: Validate that value is a plain string (not object)
 */
function validatePlainString(value, fieldName) {
  // Reject non-strings
  if (typeof value !== "string") {
    Logger.warn("Non-string value in validator", {
      field: fieldName,
      type: typeof value,
      value: JSON.stringify(value),
    });
    return `${fieldName} must be a string, got ${typeof value}`;
  }

  // Reject if contains NoSQL operators
  if (sanitize.containsOperators({ [fieldName]: value })) {
    Logger.error("NoSQL operator detected in plain string field", {
      field: fieldName,
      value,
    });
    return `${fieldName} contains invalid characters`;
  }

  return null;
}

/**
 *  NEW: Validate topic field specifically
 */
function validateTopic(value) {
  // Must be a string
  const stringError = validatePlainString(value, "topic");
  if (stringError) return stringError;

  // Length validation
  if (value.length < 1) {
    return "Topic is required";
  }

  if (value.length > 100) {
    return "Topic must not exceed 100 characters";
  }

  // Pattern validation (alphanumeric, spaces, hyphens, underscores only)
  const topicPattern = /^[a-zA-Z0-9\s\-_]+$/;
  if (!topicPattern.test(value)) {
    return "Topic can only contain letters, numbers, spaces, hyphens, and underscores";
  }

  return null;
}

/**
 * Validate a single field based on rules
 */
function validateField(field, value, rules) {
  const errors = [];

  //  FIX: TYPE VALIDATION FIRST
  if (rules.type === "string") {
    const typeError = validatePlainString(value, field);
    if (typeError) {
      errors.push(typeError);
      return errors; // Stop further validation if type is wrong
    }
  }

  // Required validation
  if (rules.required && (value === undefined || value === null || value === "")) {
    errors.push(`${field} is required`);
  }

  // String length validation
  if (value && rules.minLength !== undefined && rules.maxLength !== undefined) {
    const lengthError = validateStringLength(value, rules.minLength, rules.maxLength, field);
    if (lengthError) {
      errors.push(lengthError);
    }
  }

  // Pattern validation
  if (value && rules.pattern) {
    if (!rules.pattern.test(value)) {
      errors.push(rules.message || `${field} format is invalid`);
    }
  }

  // Custom validation function
  if (value && rules.validate) {
    const customError = rules.validate(value);
    if (customError) {
      errors.push(customError);
    }
  }

  return errors;
}

/**
 * Validate input based on schema
 */
function validateInput(schema) {
  return (req, res, next) => {
    const errors = [];

    Object.keys(schema).forEach((field) => {
      const value = req.body[field];
      const rules = schema[field];

      const fieldErrors = validateField(field, value, rules);
      errors.push(...fieldErrors);
    });

    if (errors.length > 0) {
      Logger.warn("Input validation failed", {
        path: req.path,
        errors,
        body: JSON.stringify(req.body),
      });

      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: errors,
        },
      });
    }

    next();
  };
}

/**
 *  ENHANCED: Validate signup
 */
const validateSignup = validateInput({
  username: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.username.minLength,
    maxLength: inputLimits.auth.username.maxLength,
    pattern: inputLimits.auth.username.pattern,
    message: inputLimits.auth.username.description,
  },
  email: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.email.minLength,
    maxLength: inputLimits.auth.email.maxLength,
    pattern: inputLimits.auth.email.pattern,
    message: inputLimits.auth.email.description,
  },
  password: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.password.minLength,
    maxLength: inputLimits.auth.password.maxLength,
    pattern: inputLimits.auth.password.pattern,
    message: inputLimits.auth.password.description,
  },
  fullname: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.fullname.minLength,
    maxLength: inputLimits.auth.fullname.maxLength,
    pattern: inputLimits.auth.fullname.pattern,
    message: inputLimits.auth.fullname.description,
  },
});

/**
 *  ENHANCED: Validate login
 */
const validateLogin = validateInput({
  emailOrUsername: {
    type: "string",
    required: true,
    minLength: 3,
    maxLength: 255,
  },
  password: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.password.minLength,
    maxLength: inputLimits.auth.password.maxLength,
  },
});

/**
 * Contact form validator
 */
const validateContact = validateInput({
  name: {
    required: true,
    min: inputLimits.contact.name.min,
    max: inputLimits.contact.name.max,
    description: inputLimits.contact.name.description,
  },
  email: {
    required: true,
    min: inputLimits.contact.email.min,
    max: inputLimits.contact.email.max,
    pattern: inputLimits.contact.email.pattern,
    description: inputLimits.contact.email.description,
  },
  subject: {
    required: true,
    min: inputLimits.contact.subject.min,
    max: inputLimits.contact.subject.max,
    description: inputLimits.contact.subject.description,
  },
  message: {
    required: true,
    min: inputLimits.contact.message.min,
    max: inputLimits.contact.message.max,
    description: inputLimits.contact.message.description,
  },
});

/**
 * Question creation validator
 */
const validateQuestion = validateInput({
  questionText: {
    required: true,
    min: inputLimits.question.text.min,
    max: inputLimits.question.text.max,
    description: inputLimits.question.text.description,
  },
  topic: {
    required: true,
    min: inputLimits.question.topic.min,
    max: inputLimits.question.topic.max,
    pattern: inputLimits.question.topic.pattern,
    description: inputLimits.question.topic.description,
  },
  options: {
    required: true,
    isArray: true,
    maxLength: 8,
    custom: (options) => {
      if (!Array.isArray(options)) {
        return { valid: false, error: "Options must be an array" };
      }
      if (options.length < 2) {
        return { valid: false, error: "Must provide at least 2 options" };
      }
      for (const opt of options) {
        if (typeof opt !== "string") {
          return { valid: false, error: "Each option must be a string" };
        }
        if (opt.trim().length < 1 || opt.trim().length > 500) {
          return { valid: false, error: "Each option must be 1-500 characters" };
        }
      }
      return { valid: true };
    },
  },
  explanation: {
    required: false,
    min: 0,
    max: inputLimits.question.explanation.max,
    description: inputLimits.question.explanation.description,
  },
});

/**
 * B2B: Validate org (school) registration — used on POST /api/onboarding/org/register.
 *
 * The contact person becomes the org owner. We validate:
 *   orgName, contactName, contactEmail, contactPassword, schoolType, estimatedEnrollment
 *
 * schoolType and estimatedEnrollment are custom-validated because they are not
 * plain string length checks.
 */
const VALID_SCHOOL_TYPES = ["primary", "secondary", "combined", "tertiary", "other"];

const validateOrgRegister = (req, res, next) => {
  const errors = [];
  const {
    orgName,
    contactName,
    contactEmail,
    contactPassword,
    schoolType,
    estimatedEnrollment,
  } = req.body;

  // orgName
  const orgNameLimits = inputLimits.org.orgName;
  if (!orgName || typeof orgName !== "string") {
    errors.push("School name is required");
  } else if (
    orgName.trim().length < orgNameLimits.minLength ||
    orgName.trim().length > orgNameLimits.maxLength
  ) {
    errors.push(
      `School name must be ${orgNameLimits.minLength}-${orgNameLimits.maxLength} characters`,
    );
  } else if (!orgNameLimits.pattern.test(orgName.trim())) {
    errors.push(orgNameLimits.description);
  }

  // contactName (the owner's full name)
  const contactNameLimits = inputLimits.org.contactName;
  if (!contactName || typeof contactName !== "string") {
    errors.push("Contact name is required");
  } else if (
    contactName.trim().length < contactNameLimits.minLength ||
    contactName.trim().length > contactNameLimits.maxLength
  ) {
    errors.push(
      `Contact name must be ${contactNameLimits.minLength}-${contactNameLimits.maxLength} characters`,
    );
  } else if (!contactNameLimits.pattern.test(contactName.trim())) {
    errors.push(contactNameLimits.description);
  }

  // contactEmail
  const emailPattern = inputLimits.auth.email.pattern;
  if (!contactEmail || typeof contactEmail !== "string") {
    errors.push("A valid contact email is required");
  } else if (!emailPattern.test(contactEmail.trim())) {
    errors.push("Contact email address format is invalid");
  }

  // contactPassword — re-use the same strong password rules as regular signup
  const passwordLimits = inputLimits.auth.password;
  if (!contactPassword || typeof contactPassword !== "string") {
    errors.push("Password is required");
  } else if (
    contactPassword.length < passwordLimits.minLength ||
    contactPassword.length > passwordLimits.max
  ) {
    errors.push(
      `Password must be ${passwordLimits.minLength}-${passwordLimits.max} characters`,
    );
  } else if (!passwordLimits.pattern.test(contactPassword)) {
    errors.push(passwordLimits.description);
  }

  // schoolType — optional; defaults to 'secondary' in handler if omitted
  if (schoolType !== undefined && !VALID_SCHOOL_TYPES.includes(schoolType)) {
    errors.push(inputLimits.org.schoolType.description);
  }

  // estimatedEnrollment — number, validated after parsing
  if (estimatedEnrollment !== undefined) {
    const parsed = parseInt(estimatedEnrollment, 10);
    if (
      Number.isNaN(parsed) ||
      parsed < inputLimits.org.estimatedEnrollment.min ||
      parsed > inputLimits.org.estimatedEnrollment.max
    ) {
      errors.push(inputLimits.org.estimatedEnrollment.description);
    }
  }

  if (errors.length > 0) {
    Logger.warn("Org registration validation failed", { path: req.path, errors });
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request. Please check your input.",
        details: errors,
      },
    });
  }

  next();
};

/**
 * B2B: Validate org member self-signup — used on POST /api/auth/signup when
 * a teacher or student attempts to create their own account.
 *
 * Identical field rules to validateSignup. The difference is context:
 * if an inviteToken is present, the account becomes active immediately;
 * if not, the account enters pending_approval state (handled in the route handler).
 *
 * inviteToken is optional — no validation rule needed here since the handler
 * does its own invite-token lookup with length capping.
 */
const validateOrgMemberSignup = validateInput({
  username: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.username.minLength,
    maxLength: inputLimits.auth.username.max,
    pattern: inputLimits.auth.username.pattern,
    message: inputLimits.auth.username.description,
  },
  email: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.email.minLength,
    maxLength: inputLimits.auth.email.max,
    pattern: inputLimits.auth.email.pattern,
    message: inputLimits.auth.email.description,
  },
  password: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.password.minLength,
    maxLength: inputLimits.auth.password.max,
    pattern: inputLimits.auth.password.pattern,
    message: inputLimits.auth.password.description,
  },
  fullname: {
    type: "string",
    required: true,
    minLength: inputLimits.auth.fullname.minLength,
    maxLength: inputLimits.auth.fullname.max,
    pattern: inputLimits.auth.fullname.pattern,
    message: inputLimits.auth.fullname.description,
  },
});

module.exports = {
  validateInput,
  validateSignup,
  validateLogin,
  validateContact,
  validateQuestion,
  validateStringLength,
  validateField,
  validatePlainString,
  validateTopic,
  validateOrgRegister,
  validateOrgMemberSignup,
};
