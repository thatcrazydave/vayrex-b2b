const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { PasswordValidator, AccountLockout } = require("../security/passwordValidator");
const { validateSignup, validateLogin } = require("../middleware/inputValidator");
const {
  checkAccountLockout,
  handleFailedLogin,
  handleSuccessfulLogin,
} = require("../middleware/accountLockout");
const Logger = require("../logger");
const TokenService = require("../services/tokenService");
const { authenticateToken } = require("../middleware/auth");
const emailService = require("../services/emailService");
const { recordAuthFailure } = require("../middleware/advancedRateLimiter");
const { createEndpointLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// ===== Signup =====
router.post("/signup", validateSignup, async (req, res) => {
  try {
    const { username, email, password, fullname } = req.body;
    const passwordValidation = PasswordValidator.validate(password);

    if (!passwordValidation.isValid) {
      Logger.warn("Weak password attempt at signup", {
        email,
        errors: passwordValidation.errors,
      });

      return res.status(400).json({
        success: false,
        error: {
          code: "WEAK_PASSWORD",
          message: "Password does not meet security requirements",
          details: passwordValidation.errors,
          strength: passwordValidation.strength,
          score: passwordValidation.score,
          requirements: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            noCommonPasswords: true,
          },
        },
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
    });

    if (existingUser) {
      // SECURITY: Generic message — don't reveal which field matched (prevents enumeration)
      Logger.warn("Signup attempt with existing credentials", {
        email: email.toLowerCase(),
        ip: req.ip,
      });

      // If an invite token was supplied, tell the frontend to send the user
      // to the login page so they can accept the invite while authenticated.
      const hasInvite = !!(req.body.inviteToken && typeof req.body.inviteToken === "string");

      return res.status(409).json({
        success: false,
        error: {
          code: "USER_EXISTS",
          message: hasInvite
            ? "You already have an account. Please log in to accept the invitation."
            : "Account already registered",
          ...(hasInvite && { hint: "LOGIN_TO_ACCEPT_INVITE" }),
        },
      });
    }

    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      fullname,
      role: "user",
      emailVerified: false,
      // Self-signup without an invite token goes into pending review.
      // The account becomes active only when org admin or Vayrex staff approves it.
      // If an inviteToken is provided below, this is overridden to 'active'.
      accountStatus: "pending_approval",
    });

    // Generate email verification token AND 6-digit code
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code

    user.emailVerificationToken = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");
    user.emailVerificationCode = verificationCode;
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    user.emailVerificationCodeExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    await user.save();

    // B2B: If inviteToken is provided, accept the invitation and link user to org
    const { inviteToken } = req.body;
    if (inviteToken && typeof inviteToken === "string" && inviteToken.length <= 256) {
      try {
        const Invitation = require("../models/Invitation");
        const Organization = require("../models/Organization");

        const invite = await Invitation.findByToken(inviteToken);
        if (
          invite &&
          invite.email === user.email.toLowerCase() &&
          invite.status === "pending"
        ) {
          const org = await Organization.findById(invite.orgId)
            .select("_id enrollmentCount enrollmentCapacity")
            .lean();
          if (org) {
            // Link user to org and set account active — invite is authorisation
            user.organizationId = invite.orgId;
            user.orgRole = invite.orgRole;
            user.seatAssignedAt = new Date();
            user.accountStatus = "active"; // invite acceptance clears pending state
            if (invite.classId) user.classId = invite.classId;

            // Guardian: link to child student(s) via guardianCode
            if (invite.orgRole === "guardian" && invite.guardianCode) {
              // guardianCode is the student's userId or a code that maps to student(s)
              const studentUser = await User.findOne({
                _id: invite.guardianCode,
                organizationId: invite.orgId,
                orgRole: "student",
              }).lean();
              if (studentUser) {
                user.guardianOf = [studentUser._id];
              }
            }

            await user.save();

            // Mark invite accepted
            invite.status = "accepted";
            invite.acceptedAt = new Date();
            await invite.save();

            // Increment enrollment count
            await Organization.findByIdAndUpdate(invite.orgId, {
              $inc: { enrollmentCount: 1 },
            });

            Logger.info("Invitation accepted at signup", {
              userId: user._id,
              orgId: invite.orgId,
              role: invite.orgRole,
            });
          }
        }
      } catch (inviteErr) {
        // Non-fatal: log and continue — user account was created successfully
        Logger.error("Failed to process invite token at signup (non-fatal)", {
          error: inviteErr.message,
          userId: user._id,
        });
      }
    }

    Logger.info("New user registered", {
      userId: user._id,
      email: user.email,
      orgRole: user.orgRole || null,
      accountStatus: user.accountStatus,
    });

    // If the account is still pending_approval (no invite), do not issue tokens.
    // The user must wait for approval before they can authenticate.
    if (user.accountStatus === "pending_approval") {
      return res.status(201).json({
        success: true,
        data: null,
        pending: true,
        message:
          "Registration received. Your account is pending review. You will be notified by email once it is approved.",
        timestamp: new Date().toISOString(),
      });
    }

    // Send verification email asynchronously (NOT awaited to prevent timeout)
    emailService
      .sendVerificationEmail(user.email, user.username, verificationToken, verificationCode)
      .then(() => Logger.info("Verification email sent", { userId: user._id }))
      .catch((emailError) => {
        Logger.error("Failed to send verification email", {
          userId: user._id,
          error: emailError.message,
        });
      });

    const accessToken = TokenService.generateAccessToken(user, "15m");
    const refreshToken = TokenService.generateRefreshToken(user);

    res.status(201).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          fullname: user.fullname,
          role: user.role,
          organizationId: user.organizationId,
          orgRole: user.orgRole,
          classId: user.classId,
          guardianOf: user.guardianOf || [],
          limits: user.limits,
          usage: user.usage,
        },
        expiresIn: 15 * 60,
        refreshExpiresIn: 7 * 24 * 60 * 60,
        tabIsolated: true, // Pure tab isolation - no shared state
      },
      message: "Account created successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error("Signup error", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Server error during signup",
      },
    });
  }
});

// ===== Login =====
router.post("/login", validateLogin, checkAccountLockout, async (req, res) => {
  try {
    const { emailOrUsername, username, email, password } = req.body;

    const loginIdentifier = emailOrUsername || username || email;

    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_CREDENTIALS",
          message: "Email/username and password are required",
        },
      });
    }

    // Find user
    const user = await User.findOne({
      $or: [
        { email: loginIdentifier.toLowerCase().trim() },
        { username: loginIdentifier.toLowerCase().trim() },
      ],
    }).select("+password");

    if (!user) {
      //  Track failed attempt (even for non-existent user to prevent enumeration)
      await handleFailedLogin(loginIdentifier.toLowerCase(), req);

      // Feed L2/L3 adversarial layers
      recordAuthFailure(req.ip, loginIdentifier.toLowerCase()).catch(() => {});

      Logger.warn("Login attempt for non-existent user", {
        identifier: loginIdentifier,
        ip: req.ip,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid credentials",
        },
      });
    }

    // Check subscription expiry — only applies to non-org accounts
    if (
      !user.organizationId &&
      user.isSubscriptionExpired() &&
      user.subscriptionTier !== "free"
    ) {
      user.subscriptionTier = "free";
      user.subscriptionStatus = "expired";
      await user.save();
    }

    // Block accounts that are pending admin approval
    if (user.accountStatus === "pending_approval") {
      Logger.warn("Login attempt on pending account", {
        userId: user._id,
        email: user.email,
        ip: req.ip,
      });

      return res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_PENDING_APPROVAL",
          message:
            "Your account is pending review. You will receive an email once it has been approved.",
        },
      });
    }

    // Block suspended accounts
    if (user.accountStatus === "suspended") {
      Logger.warn("Login attempt on suspended account", {
        userId: user._id,
        email: user.email,
        ip: req.ip,
      });

      return res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_SUSPENDED",
          message:
            "Your account has been suspended. Please contact your organisation administrator.",
        },
      });
    }

    // Check if account is inactive
    if (!user.isActive) {
      Logger.warn("Login attempt on inactive account", {
        userId: user._id,
        email: user.email,
        ip: req.ip,
      });

      return res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_INACTIVE",
          message: "Account is inactive. Please contact support.",
        },
      });
    }

    //  Verify password
    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      //  NEW: Handle failed login attempt
      const attemptResult = await handleFailedLogin(user.email, req);

      // Feed L2/L3 adversarial layers
      recordAuthFailure(req.ip, user.email).catch(() => {});

      Logger.warn("Failed login attempt", {
        userId: user._id,
        email: user.email,
        ip: req.ip,
        attempts: attemptResult.attempts,
        remaining: attemptResult.remainingAttempts,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid credentials",
        },
      });
    }

    await handleSuccessfulLogin(user.email, req);

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    Logger.info("Successful login", {
      userId: user._id,
      email: user.email,
      ip: req.ip,
      orgRole: user.orgRole || null,
    });

    // PURE TAB ISOLATION: Long-lived token (7 days) in sessionStorage only
    const accessToken = TokenService.generateAccessToken(user, "15m");
    const refreshToken = TokenService.generateRefreshToken(user);

    const userResponse = {
      id: user._id,
      username: user.username,
      email: user.email,
      fullname: user.fullname,
      role: user.role,
      isActive: user.isActive,
      provider: user.provider || "email",
      emailVerified: user.emailVerified || false,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      organizationId: user.organizationId,
      orgRole: user.orgRole,
      classId: user.classId,
      guardianOf: user.guardianOf || [],
      limits: user.limits,
      usage: user.usage,
    };

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: userResponse,
        isAdmin: user.role === "admin" || user.role === "superadmin",
        isSuperAdmin: user.role === "superadmin",
        expiresIn: 15 * 60,
        refreshExpiresIn: 7 * 24 * 60 * 60,
        tabIsolated: true,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Login error", {
      error: err.message,
      stack: err.stack,
    });

    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "An error occurred during login",
      },
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_REFRESH_TOKEN",
          message: "Refresh token is required",
        },
      });
    }

    const decoded = TokenService.verifyRefreshToken(refreshToken);

    const isRevoked = await TokenService.isTokenRevoked(decoded.jti);
    if (isRevoked) {
      return res.status(401).json({
        success: false,
        error: {
          code: "TOKEN_REVOKED",
          message: "Refresh token has been revoked",
        },
      });
    }

    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found or inactive",
        },
      });
    }

    // B2B: Block suspended accounts on token refresh
    if (user.accountStatus === "suspended") {
      await TokenService.revokeToken(decoded.jti, 0);
      return res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_SUSPENDED",
          message:
            "Your account has been suspended. Please contact your organisation administrator.",
        },
      });
    }

    if (decoded.tokenVersion !== user.tokenVersion) {
      await TokenService.revokeToken(decoded.jti, 7 * 24 * 60 * 60);

      return res.status(401).json({
        success: false,
        error: {
          code: "TOKEN_VERSION_MISMATCH",
          message: "Token version mismatch, please log in again",
          roleChanged: true,
        },
      });
    }
    const newAccessToken = TokenService.generateAccessToken(user, "15m");

    const newRefreshToken = TokenService.generateRefreshToken(user);

    const remainingTTL = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
    await TokenService.revokeToken(decoded.jti, remainingTTL);

    Logger.info("Token refreshed", {
      userId: user._id,
      oldJti: decoded.jti,
      newRole: user.role,
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 15 * 60,
        refreshExpiresIn: 7 * 24 * 60 * 60,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          fullname: user.fullname,
          role: user.role,
          photoURL: user.photoURL,
          provider: user.provider || "email",
          emailVerified: user.emailVerified || false,
          organizationId: user.organizationId,
          orgRole: user.orgRole,
          classId: user.classId,
          limits: user.limits,
          usage: user.usage,
          isAdmin: user.role === "admin" || user.role === "superadmin",
          isSuperAdmin: user.role === "superadmin",
        },
      },
    });
  } catch (err) {
    Logger.error("Token refresh error", {
      error: err.message,
    });

    res.status(401).json({
      success: false,
      error: {
        code: "REFRESH_FAILED",
        message: "Failed to refresh token",
      },
    });
  }
});

// ===== Logout Endpoint =====
// Pure tab isolation: Client just deletes sessionStorage token
// No server-side work needed since tokens are long-lived and self-contained
router.post("/logout", async (req, res) => {
  try {
    Logger.info("User logout", {
      userId: req.user?.id || "unknown",
      ip: req.ip,
    });

    res.json({
      success: true,
      message: "Logged out successfully. Token removed from client.",
    });
  } catch (error) {
    Logger.error("Logout error", { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Error during logout",
      },
    });
  }
});

// ===== Email Verification =====
router.get("/verify-email/:token", async (req, res) => {
  try {
    const { token } = req.params;

    // Hash token to compare with stored hashed token
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Email verification token is invalid or has expired",
        },
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    user.emailVerificationCode = undefined;
    user.emailVerificationCodeExpires = undefined;
    await user.save();

    Logger.info("Email verified", { userId: user._id, email: user.email });

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user.email, user.username);
      Logger.info("Welcome email sent", { userId: user._id });
    } catch (emailError) {
      Logger.error("Failed to send welcome email", {
        userId: user._id,
        error: emailError.message,
      });
      // Don't fail verification if welcome email fails
    }

    res.json({
      success: true,
      message: "Email verified successfully! You can now access all features.",
      data: {
        email: user.email,
        verified: true,
      },
    });
  } catch (error) {
    Logger.error("Email verification error", { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Error verifying email",
      },
    });
  }
});

// ===== Email Verification with Code =====
router.post("/verify-email-code", async (req, res) => {
  try {
    const { code, email } = req.body;

    if (!code || !email) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_FIELDS",
          message: "Email and verification code are required",
        },
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      emailVerificationCode: code,
      emailVerificationCodeExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_CODE",
          message: "Verification code is invalid or has expired",
        },
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    user.emailVerificationCode = undefined;
    user.emailVerificationCodeExpires = undefined;
    await user.save();

    Logger.info("Email verified via code", { userId: user._id, email: user.email });

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user.email, user.username);
      Logger.info("Welcome email sent", { userId: user._id });
    } catch (emailError) {
      Logger.error("Failed to send welcome email", {
        userId: user._id,
        error: emailError.message,
      });
    }

    res.json({
      success: true,
      message: "Email verified successfully! You can now access all features.",
      data: {
        email: user.email,
        verified: true,
      },
    });
  } catch (error) {
    Logger.error("Email verification code error", { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Error verifying email",
      },
    });
  }
});

// ===== Resend Verification Email =====
const resendVerificationLimiter = createEndpointLimiter(
  3,
  15 * 60 * 1000,
  "Too many verification emails sent. Please wait 15 minutes before trying again.",
);

router.post(
  "/resend-verification",
  authenticateToken,
  resendVerificationLimiter,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
      }

      if (user.emailVerified) {
        return res.status(400).json({
          success: false,
          error: {
            code: "ALREADY_VERIFIED",
            message: "Email is already verified",
          },
        });
      }

      // Generate new verification token AND code
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

      user.emailVerificationToken = crypto
        .createHash("sha256")
        .update(verificationToken)
        .digest("hex");
      user.emailVerificationCode = verificationCode;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      user.emailVerificationCodeExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      await user.save();

      // Send verification email with both token and code
      await emailService.sendVerificationEmail(
        user.email,
        user.username,
        verificationToken,
        verificationCode,
      );

      Logger.info("Verification email resent", { userId: user._id });

      res.json({
        success: true,
        message: "Verification email sent! Please check your inbox.",
      });
    } catch (error) {
      Logger.error("Resend verification error", { error: error.message });
      res.status(500).json({
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "Error sending verification email",
        },
      });
    }
  },
);

// ===== Forgot Password =====
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_EMAIL",
          message: "Email is required",
        },
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always return success even if user doesn't exist (security best practice)
    if (!user) {
      Logger.warn("Password reset requested for non-existent email", { email });
      return res.json({
        success: true,
        message: "If an account with that email exists, a password reset link has been sent.",
      });
    }

    // Generate reset token AND 6-digit code
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code

    user.passwordResetToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    user.passwordResetCode = resetCode;
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    user.passwordResetCodeExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    // Send reset email with both token and code
    await emailService.sendPasswordResetEmail(
      user.email,
      user.username,
      resetToken,
      resetCode,
    );

    Logger.info("Password reset email sent", { userId: user._id });

    res.json({
      success: true,
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    Logger.error("Forgot password error", { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Error processing password reset request",
      },
    });
  }
});

// ===== Reset Password =====
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_PASSWORD",
          message: "New password is required",
        },
      });
    }

    // Validate password strength
    const passwordValidation = PasswordValidator.validate(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: "WEAK_PASSWORD",
          message: "Password does not meet security requirements",
          details: passwordValidation.errors,
          strength: passwordValidation.strength,
          score: passwordValidation.score,
        },
      });
    }

    // Hash token to compare with stored hashed token
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select("+password");

    if (!user) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Password reset token is invalid or has expired",
        },
      });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetCode = undefined;
    user.passwordResetCodeExpires = undefined;
    await user.save();

    Logger.info("Password reset successful", { userId: user._id });

    res.json({
      success: true,
      message:
        "Password has been reset successfully! You can now login with your new password.",
    });
  } catch (error) {
    Logger.error("Reset password error", { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Error resetting password",
      },
    });
  }
});

// ===== Reset Password with Code =====
router.post("/reset-password-code", async (req, res) => {
  try {
    const { email, code, password } = req.body;

    if (!email || !code || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_FIELDS",
          message: "Email, verification code, and new password are required",
        },
      });
    }

    // Validate password strength
    const passwordValidation = PasswordValidator.validate(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: "WEAK_PASSWORD",
          message: "Password does not meet security requirements",
          details: passwordValidation.errors,
          strength: passwordValidation.strength,
          score: passwordValidation.score,
        },
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      passwordResetCode: code,
      passwordResetCodeExpires: { $gt: Date.now() },
    }).select("+password");

    if (!user) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_CODE",
          message: "Password reset code is invalid or has expired",
        },
      });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetCode = undefined;
    user.passwordResetCodeExpires = undefined;
    await user.save();

    Logger.info("Password reset successful via code", { userId: user._id });

    res.json({
      success: true,
      message:
        "Password has been reset successfully! You can now login with your new password.",
    });
  } catch (error) {
    Logger.error("Reset password code error", { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Error resetting password",
      },
    });
  }
});

// ===== B2B: Accept Invitation =====
// GET /api/auth/accept-invite/:token — validates token, returns invite metadata for the signup form
router.get("/accept-invite/:token", async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== "string" || token.length > 256) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_TOKEN", message: "Invalid invitation token" },
      });
    }

    const Invitation = require("../models/Invitation");
    const Organization = require("../models/Organization");

    const invite = await Invitation.findByToken(token);
    if (!invite) {
      return res.status(404).json({
        success: false,
        error: { code: "INVITE_NOT_FOUND", message: "Invitation not found or has expired" },
      });
    }

    const org = await Organization.findById(invite.orgId)
      .select("name slug subdomain plan")
      .lean();

    return res.json({
      success: true,
      invite: {
        id: invite._id,
        email: invite.email,
        orgRole: invite.orgRole,
        orgId: invite.orgId,
        classId: invite.classId,
        guardianCode: invite.guardianCode,
        expiresAt: invite.expiresAt,
      },
      org: org || null,
    });
  } catch (err) {
    Logger.error("accept-invite GET error", { error: err.message });
    return res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to validate invitation" },
    });
  }
});

// ===== B2B: Accept Invitation (Existing User) =====
// POST /api/auth/accept-invite — for users who already have an account
router.post("/accept-invite", authenticateToken, async (req, res) => {
  try {
    const { inviteToken } = req.body;
    if (!inviteToken || typeof inviteToken !== "string" || inviteToken.length > 256) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_TOKEN", message: "Invitation token is required" },
      });
    }

    const Invitation = require("../models/Invitation");
    const Organization = require("../models/Organization");

    const invite = await Invitation.findByToken(inviteToken);
    if (!invite || invite.status !== "pending") {
      return res.status(404).json({
        success: false,
        error: {
          code: "INVITE_NOT_FOUND",
          message: "Invitation not found, expired, or already used",
        },
      });
    }

    // Email must match
    if (invite.email !== req.user.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: {
          code: "EMAIL_MISMATCH",
          message: "This invitation was sent to a different email address",
        },
      });
    }

    // User must not already belong to a different org
    if (
      req.user.organizationId &&
      req.user.organizationId.toString() !== invite.orgId.toString()
    ) {
      return res.status(409).json({
        success: false,
        error: {
          code: "ALREADY_IN_ORG",
          message: "You already belong to a different organisation",
        },
      });
    }

    // Already in this org? Just return success
    if (
      req.user.organizationId &&
      req.user.organizationId.toString() === invite.orgId.toString()
    ) {
      invite.status = "accepted";
      invite.acceptedAt = new Date();
      await invite.save();
      return res.json({
        success: true,
        message: "You are already a member of this organisation",
        user: {
          id: req.user._id,
          organizationId: req.user.organizationId,
          orgRole: req.user.orgRole,
        },
      });
    }

    const org = await Organization.findById(invite.orgId)
      .select("_id enrollmentCount enrollmentCapacity")
      .lean();

    if (!org) {
      return res.status(404).json({
        success: false,
        error: { code: "ORG_NOT_FOUND", message: "Organisation no longer exists" },
      });
    }

    // Check capacity
    if (org.enrollmentCount >= org.enrollmentCapacity) {
      return res.status(409).json({
        success: false,
        error: {
          code: "ORG_FULL",
          message: "Organisation has reached its maximum seat capacity",
        },
      });
    }

    // Link user to org
    const user = await User.findById(req.user._id);
    user.organizationId = invite.orgId;
    user.orgRole = invite.orgRole;
    user.seatAssignedAt = new Date();
    user.accountStatus = "active";
    if (invite.classId) user.classId = invite.classId;

    // Guardian linking
    if (invite.orgRole === "guardian" && invite.guardianCode) {
      const studentUser = await User.findOne({
        _id: invite.guardianCode,
        organizationId: invite.orgId,
        orgRole: "student",
      }).lean();
      if (studentUser) {
        user.guardianOf = [studentUser._id];
      }
    }

    // Increment token version to force re-auth with new org claims
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Mark invite accepted
    invite.status = "accepted";
    invite.acceptedAt = new Date();
    await invite.save();

    // Increment org enrollment
    await Organization.findByIdAndUpdate(invite.orgId, { $inc: { enrollmentCount: 1 } });

    // Issue new tokens with updated claims
    const accessToken = TokenService.generateAccessToken(user, "15m");
    const refreshToken = TokenService.generateRefreshToken(user);

    Logger.info("Existing user accepted invitation", {
      userId: user._id,
      orgId: invite.orgId,
      orgRole: invite.orgRole,
    });

    return res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          fullname: user.fullname,
          role: user.role,
          organizationId: user.organizationId,
          orgRole: user.orgRole,
          classId: user.classId,
          limits: user.limits,
          usage: user.usage,
        },
        expiresIn: 15 * 60,
        refreshExpiresIn: 7 * 24 * 60 * 60,
      },
      message: "Invitation accepted successfully",
    });
  } catch (err) {
    Logger.error("POST accept-invite error", { error: err.message });
    return res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to accept invitation" },
    });
  }
});

module.exports = router;
