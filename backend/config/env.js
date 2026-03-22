const Logger = require('../logger');

function validateEnvironment() {
  const errors = [];
  const warnings = [];

  // ===== CRITICAL VARIABLES =====
  const critical = {
    JWT_SECRET: {
      minLength: 32,
      description: 'JWT signing secret'
    },
    MONGODB_URI: {
      pattern: /^mongodb/,
      description: 'MongoDB connection string'
    },
    AWS_ACCESS_KEY_ID: {
      minLength: 16,
      description: 'AWS access key'
    },
    AWS_SECRET_ACCESS_KEY: {
      minLength: 32,
      description: 'AWS secret key'
    },
    S3_BUCKET_NAME: {
      pattern: /^[a-z0-9\-]{3,63}$/,
      description: 'S3 bucket name'
    }
  };

  // ===== CHECK CRITICAL =====
  for (const [key, rules] of Object.entries(critical)) {
    const value = process.env[key];

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

  // ===== CHECK JWT SECRET QUALITY =====
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < 64) {
      warnings.push(`   JWT_SECRET: Consider using 64+ characters for production`);
    }
  }

  // ===== CHECK MONGODB URI IN PRODUCTION =====
  if (process.env.NODE_ENV === 'production' && 
      process.env.MONGODB_URI?.includes('localhost')) {
    errors.push(`  MONGODB_URI: Cannot use localhost in production`);
  }

  // ===== CHECK PAYSTACK KEY =====
  if (!process.env.PAYSTACK_SECRET_KEY) {
    warnings.push(`   PAYSTACK_SECRET_KEY: Not set - payment features will be disabled`);
  } else if (!process.env.PAYSTACK_SECRET_KEY.startsWith('sk_')) {
    warnings.push(`   PAYSTACK_SECRET_KEY: Should start with 'sk_' (test: sk_test_, live: sk_live_)`);
  }

  // ===== CHECK FRONTEND URL =====
  if (process.env.NODE_ENV === 'production' && !process.env.PRODUCTION_FRONTEND_URL) {
    warnings.push(`   PRODUCTION_FRONTEND_URL: Not set - CORS will be restrictive`);
  }

  // ===== OUTPUT RESULTS =====
  if (errors.length > 0 || warnings.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('  ENVIRONMENT VALIDATION');
    console.log('='.repeat(60) + '\n');
  }

  if (errors.length > 0) {
    console.error('  CRITICAL ERRORS:\n');
    errors.forEach(e => console.error(`  ${e}`));
    console.error('\n  Fix these errors before starting the server\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('   WARNINGS:\n');
    warnings.forEach(w => console.warn(`  ${w}\n`));
  }

  console.log('  Environment validation passed\n');
}

module.exports = { validateEnvironment };