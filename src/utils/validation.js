// ===== Backend-aligned Validation Utilities =====
// SECURITY: Integrates XSS sanitization for all user inputs

import { sanitizeText, sanitizeFormInput, detectXSS } from './xssSanitizer';

// Topic validation: 3-10 chars, letters/numbers/hyphens
export const validateTopic = (topic) => {
  if (!topic || typeof topic !== 'string') {
    return { isValid: false, error: "Topic is required" };
  }
  
  // XSS Detection
  if (detectXSS(topic)) {
    return { isValid: false, error: "Invalid characters detected" };
  }
  
  const trimmed = sanitizeText(topic).trim();
  if (trimmed.length < 3) {
    return { isValid: false, error: "Topic must be at least 3 characters" };
  }
  if (trimmed.length > 10) {
    return { isValid: false, error: "Topic must not exceed 10 characters" };
  }
  const regex = /^[a-zA-Z0-9-]{3,10}$/;
  if (!regex.test(trimmed)) {
    return { isValid: false, error: "Topic can only contain letters, numbers, and hyphens" };
  }
  return { isValid: true, error: null, sanitized: trimmed };
};

// Question text validation: 10-5000 chars
export const validateQuestionText = (text) => {
  if (!text || typeof text !== 'string') {
    return { isValid: false, error: "Question text is required" };
  }
  
  // XSS Detection
  if (detectXSS(text)) {
    return { isValid: false, error: "Invalid characters detected in question" };
  }
  
  const trimmed = sanitizeText(text).trim();
  if (trimmed.length < 10) {
    return { isValid: false, error: "Question must be at least 10 characters" };
  }
  if (trimmed.length > 5000) {
    return { isValid: false, error: "Question must not exceed 5000 characters" };
  }
  return { isValid: true, error: null, sanitized: trimmed };
};

// Options validation: 4-6 options
export const validateOptions = (options) => {
  if (!Array.isArray(options)) {
    return { isValid: false, error: "Options must be an array" };
  }
  if (options.length < 4) {
    return { isValid: false, error: "Must have at least 4 options" };
  }
  if (options.length > 6) {
    return { isValid: false, error: "Must have at most 6 options" };
  }
  
  const sanitizedOptions = [];
  
  for (let i = 0; i < options.length; i++) {
    if (!options[i] || typeof options[i] !== 'string') {
      return { isValid: false, error: `Option ${i + 1} is invalid` };
    }
    
    // XSS Detection
    if (detectXSS(options[i])) {
      return { isValid: false, error: `Option ${i + 1} contains invalid characters` };
    }
    
    const trimmed = sanitizeText(options[i]).trim();
    if (trimmed.length < 1) {
      return { isValid: false, error: `Option ${i + 1} cannot be empty` };
    }
    if (trimmed.length > 500) {
      return { isValid: false, error: `Option ${i + 1} exceeds 500 characters` };
    }
    
    sanitizedOptions.push(trimmed);
  }
  
  return { isValid: true, error: null, sanitized: sanitizedOptions };
};

// Correct answer validation
export const validateCorrectAnswer = (answer, optionsLength) => {
  if (typeof answer !== 'number') {
    return { isValid: false, error: "Correct answer must be a number" };
  }
  if (answer < 0 || answer >= optionsLength) {
    return { isValid: false, error: "Correct answer index is out of range" };
  }
  return { isValid: true, error: null };
};

// Email validation
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Password validation
export const validatePassword = (password) => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  
  return {
    isValid: password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers,
    errors: {
      minLength: password.length < minLength ? `Must be at least ${minLength} characters` : null,
      hasUpperCase: !hasUpperCase ? 'Must contain uppercase letter' : null,
      hasLowerCase: !hasLowerCase ? 'Must contain lowercase letter' : null,
      hasNumbers: !hasNumbers ? 'Must contain a number' : null,
    }
  };
};

// Username validation: 3-20 chars, letters/numbers/underscore/hyphen
export const validateUsername = (username) => {
  const minLength = 3;
  const maxLength = 20;
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  
  return {
    isValid: username.length >= minLength && username.length <= maxLength && usernameRegex.test(username),
    errors: {
      minLength: username.length < minLength ? `Must be at least ${minLength} characters` : null,
      maxLength: username.length > maxLength ? `Must not exceed ${maxLength} characters` : null,
      format: !usernameRegex.test(username) ? 'Letters, numbers, underscores, and hyphens only' : null,
    }
  };
};

// Full name validation: 2+ chars
export const validateFullname = (fullname) => {
  const minLength = 2;
  
  return {
    isValid: fullname.length >= minLength,
    errors: {
      minLength: fullname.length < minLength ? `Must be at least ${minLength} characters` : null,
    }
  };
};

// ===== Form Validators =====

export const validateSignupForm = (formData) => {
  const errors = {};

  if (!formData.fullname || formData.fullname.trim() === "") {
    errors.fullname = "Full name is required";
  } else {
    const fnValidation = validateFullname(formData.fullname);
    if (!fnValidation.isValid) {
      errors.fullname = Object.values(fnValidation.errors).find(e => e);
    }
  }

  if (!formData.username || formData.username.trim() === "") {
    errors.username = "Username is required";
  } else {
    const unValidation = validateUsername(formData.username);
    if (!unValidation.isValid) {
      errors.username = Object.values(unValidation.errors).find(e => e);
    }
  }

  if (!formData.email || formData.email.trim() === "") {
    errors.email = "Email is required";
  } else if (!validateEmail(formData.email)) {
    errors.email = "Invalid email format";
  }

  if (!formData.password) {
    errors.password = "Password is required";
  } else {
    const pwValidation = validatePassword(formData.password);
    if (!pwValidation.isValid) {
      errors.password = Object.values(pwValidation.errors).find(e => e);
    }
  }

  if (!formData.confirmPassword) {
    errors.confirmPassword = "Please confirm password";
  } else if (formData.password !== formData.confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const validateLoginForm = (formData) => {
  const errors = {};

  if (!formData.emailOrUsername || formData.emailOrUsername.trim() === "") {
    errors.emailOrUsername = "Email or username is required";
  }

  if (!formData.password) {
    errors.password = "Password is required";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};
