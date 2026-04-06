const Logger = require("../logger");

function validateEnvironment() {
  const errors = [];
  const warnings = [];

  // ===== CRITICAL VARIABLES =====
  // B2B uses Supabase for storage instead of AWS S3.
  // MONGODB_B2B_URI is preferred; MONGODB_URI is the fallback.
  const critical = {
    JWT_SECRET: {
      minLength: 32,
      description: "JWT signing secret",
    },
    JWT_REFRESH_SECRET: {
      minLength: 32,
      description: "JWT refresh token secret",
    },
    MONGODB_B2B_URI: {
      pattern: /^mongodb/,
      description: "B2B MongoDB connection string",
      fallbackKey: "MONGODB_URI",
    },
    SUPABASE_URL: {
      pattern: /^https:\/\//,
      description: "Supabase project URL",
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      minLength: 20,
      description: "Supabase service role key",
    },
    SUPABASE_STORAGE_BUCKET: {
      minLength: 1,
      description: "Supabase storage bucket name",
    },
  };

  // ===== CHECK CRITICAL =====
  for (const [key, rules] of Object.entries(critical)) {
    let value = process.env[key];

    // Allow fallback key (e.g. MONGODB_URI for MONGODB_B2B_URI)
    if (!value && rules.fallbackKey) {
      value = process.env[rules.fallbackKey];
      if (value) {
        warnings.push(`  ${key}: Not set, falling back to ${rules.fallbackKey}`);
      }
    }

    if (!value) {
      errors.push(`  ${key}: Required but not set (${rules.description})`);
      continue;
    }

    if (rules.minLength && value.length < rules.minLength) {
      errors.push(`  ${key}: Too short (min ${rules.minLength} chars)`);
    }

    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push(`  ${key}: Invalid format`);
    }
  }

  // ===== CHECK JWT SECRETS ARE DIFFERENT =====
  if (process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET) {
    if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
      errors.push("  JWT_SECRET and JWT_REFRESH_SECRET must not be identical");
    }
  }

  // ===== CHECK JWT SECRET QUALITY =====
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < 64) {
      warnings.push("  JWT_SECRET: Consider using 64+ characters for production");
    }
  }

  // ===== CHECK MONGODB URI IN PRODUCTION =====
  const mongoUri = process.env.MONGODB_B2B_URI || process.env.MONGODB_URI;
  if (process.env.NODE_ENV === "production" && mongoUri?.includes("localhost")) {
    errors.push("  MONGODB_B2B_URI: Cannot use localhost in production");
  }

  // ===== CHECK PAYSTACK KEY =====
  if (!process.env.PAYSTACK_SECRET_KEY) {
    warnings.push("  PAYSTACK_SECRET_KEY: Not set - payment features will be disabled");
  } else if (!process.env.PAYSTACK_SECRET_KEY.startsWith("sk_")) {
    warnings.push(
      "  PAYSTACK_SECRET_KEY: Should start with sk_ (test: sk_test_, live: sk_live_)",
    );
  }

  // ===== CHECK FRONTEND URL =====
  if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
    warnings.push("  FRONTEND_URL: Not set - CORS will be restrictive");
  }

  // ===== CHECK REDIS =====
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    warnings.push(
      "  REDIS_URL/REDIS_HOST: Not set - rate limiting and token revocation will be disabled",
    );
  }

  // ===== OUTPUT RESULTS =====
  if (errors.length > 0 || warnings.length > 0) {
    console.log("\n" + "=".repeat(60));
    console.log("  B2B ENVIRONMENT VALIDATION");
    console.log("=".repeat(60) + "\n");
  }

  if (errors.length > 0) {
    console.error("  CRITICAL ERRORS:\n");
    errors.forEach((e) => console.error(`  ${e}`));
    console.error("\n  Fix these errors before starting the server\n");
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn("  WARNINGS:\n");
    warnings.forEach((w) => console.warn(`  ${w}\n`));
  }

  console.log("  B2B environment validation passed\n");
}

module.exports = { validateEnvironment };
