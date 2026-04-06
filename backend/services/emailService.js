const nodemailer = require("nodemailer");
const Logger = require("../logger");

class EmailService {
  constructor() {
    this.smtpConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
    this.maxRetryAttempts = Math.max(1, parseInt(process.env.SMTP_RETRY_ATTEMPTS || "3", 10));
    this.retryDelayMs = Math.max(250, parseInt(process.env.SMTP_RETRY_DELAY_MS || "1500", 10));
    const smtpIpFamilyRaw = parseInt(process.env.SMTP_IP_FAMILY || "4", 10);
    const smtpIpFamily = smtpIpFamilyRaw === 6 ? 6 : 4;

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT, 10) || 465,
      secure: parseInt(process.env.SMTP_PORT, 10) !== 587, // true for 465 (SSL), false for 587 (STARTTLS)
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS.replace(/\s+/g, ""), // strip spaces from app password
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      family: smtpIpFamily,
      // Fail fast instead of hanging indefinitely
      connectionTimeout: 10000, // 10s to establish TCP connection
      greetingTimeout: 10000, // 10s to receive SMTP greeting
      socketTimeout: 15000, // 15s idle socket timeout
    });

    // Non-fatal startup check — logs a warning if SMTP is unreachable
    // so you know immediately without crashing the server
    if (this.smtpConfigured) {
      this.transporter
        .verify()
        .then(() => {
          Logger.info("SMTP connection verified successfully");
        })
        .catch((err) => {
          Logger.warn("SMTP connection check failed — emails may not send", {
            error: err.message,
          });
        });
    } else {
      Logger.warn("SMTP credentials (SMTP_USER / SMTP_PASS) not configured — emails disabled");
    }

    // Rate limiting: track emails sent per recipient per hour
    this._emailLog = new Map(); // email -> [timestamps]
    this._maxPerHour = 5; // max 5 emails per recipient per hour
    this._cleanupInterval = setInterval(() => this._cleanupLog(), 3600000); // cleanup hourly
  }

  // Rate limiting check
  _isRateLimited(to) {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const emails = to.split(",").map((e) => e.trim());

    for (const email of emails) {
      const log = this._emailLog.get(email) || [];
      const recentSends = log.filter((ts) => ts > hourAgo);
      if (recentSends.length >= this._maxPerHour) {
        Logger.warn("Email rate limited", { email, recentSends: recentSends.length });
        return true;
      }
    }
    return false;
  }

  _recordSend(to) {
    const now = Date.now();
    const emails = to.split(",").map((e) => e.trim());
    for (const email of emails) {
      const log = this._emailLog.get(email) || [];
      log.push(now);
      this._emailLog.set(email, log);
    }
  }

  _cleanupLog() {
    const hourAgo = Date.now() - 3600000;
    // SAFETY: Hard cap to prevent unbounded Map growth
    if (this._emailLog.size > 10000) {
      Logger.warn("Email log exceeded 10K entries, clearing all", {
        size: this._emailLog.size,
      });
      this._emailLog.clear();
      return;
    }
    for (const [email, timestamps] of this._emailLog) {
      const recent = timestamps.filter((ts) => ts > hourAgo);
      if (recent.length === 0) this._emailLog.delete(email);
      else this._emailLog.set(email, recent);
    }
  }

  // Validate email before sending
  _validateEmail(to) {
    if (!to || typeof to !== "string" || to.trim() === "") {
      Logger.error("Email send attempted with empty recipient");
      return false;
    }
    const emails = to.split(",").map((e) => e.trim());
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emails.every((e) => emailRegex.test(e));
  }

  _isTransientEmailError(err) {
    if (!err) return false;
    const code = (err.code || "").toString().toUpperCase();
    const msg = (err.message || "").toLowerCase();

    return (
      ["ETIMEDOUT", "ESOCKET", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"].includes(code) ||
      msg.includes("timeout") ||
      msg.includes("connection") ||
      msg.includes("socket")
    );
  }

  async _sendWithHardTimeout(mailOptions, timeoutMs) {
    return Promise.race([
      this.transporter.sendMail(mailOptions),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`SMTP send timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  // Safe send with validation, rate limiting, and a hard 20s timeout
  async _safeSend(mailOptions, context = "") {
    if (!this.smtpConfigured) {
      const err = new Error("SMTP is not configured");
      err.code = "SMTP_NOT_CONFIGURED";
      throw err;
    }

    if (!this._validateEmail(mailOptions.to)) {
      Logger.error("Invalid email recipient", { to: mailOptions.to, context });
      throw new Error("Invalid email recipient");
    }
    if (this._isRateLimited(mailOptions.to)) {
      Logger.warn("Email rate limited, skipping", { to: mailOptions.to, context });
      return; // silently skip rate-limited emails
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt += 1) {
      try {
        await this._sendWithHardTimeout(mailOptions, 20000);
        this._recordSend(mailOptions.to);
        Logger.info(`Email sent: ${context}`, { to: mailOptions.to, attempt });
        return;
      } catch (err) {
        lastError = err;
        const transient = this._isTransientEmailError(err);

        Logger.warn("Email send attempt failed", {
          context,
          to: mailOptions.to,
          attempt,
          maxAttempts: this.maxRetryAttempts,
          transient,
          error: err.message,
          code: err.code,
        });

        if (!transient || attempt >= this.maxRetryAttempts) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
      }
    }

    throw lastError || new Error("SMTP send failed");
  }

  async sendAlertEmail(to, alert) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        html: `
          <h2>System Alert</h2>
          <p><strong>Type:</strong> ${alert.type}</p>
          <p><strong>Severity:</strong> ${alert.severity}</p>
          <p><strong>Message:</strong> ${alert.message}</p>
          <p><strong>Time:</strong> ${new Date(alert.createdAt).toLocaleString()}</p>
          ${alert.details ? `<pre>${JSON.stringify(alert.details, null, 2)}</pre>` : ""}
          <p><a href="${process.env.FRONTEND_URL}/admin/alerts/${alert._id}">View Alert</a></p>
        `,
      };

      await this._safeSend(mailOptions, "sendAlertEmail");
      Logger.info("Alert email sent", { to, alertId: alert._id });
    } catch (err) {
      Logger.error("Email send error", { error: err.message, to });
      throw err;
    }
  }

  async sendWeeklyReport(to, reportData) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: `Weekly System Report - ${new Date().toLocaleDateString()}`,
        html: this.generateWeeklyReportHTML(reportData),
      };

      await this._safeSend(mailOptions, "sendWeeklyReport");
      Logger.info("Weekly report sent", { to });
    } catch (err) {
      Logger.error("Weekly report error", { error: err.message, to });
      throw err;
    }
  }

  generateWeeklyReportHTML(data) {
    return `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
            .section { margin: 20px 0; padding: 15px; border-left: 4px solid #4CAF50; }
            .metric { display: inline-block; margin: 10px 20px; }
            .metric-value { font-size: 24px; font-weight: bold; color: #4CAF50; }
            .metric-label { font-size: 12px; color: #666; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #f5f5f5; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Weekly System Report</h1>
            <p>${new Date().toLocaleDateString()}</p>
          </div>

          <div class="section">
            <h2>  Key Metrics</h2>
            <div class="metric">
              <div class="metric-value">${data.newUsers}</div>
              <div class="metric-label">New Users</div>
            </div>
            <div class="metric">
              <div class="metric-value">${data.totalUploads}</div>
              <div class="metric-label">File Uploads</div>
            </div>
            <div class="metric">
              <div class="metric-value">${data.examsTaken}</div>
              <div class="metric-label">Exams Taken</div>
            </div>
            <div class="metric">
              <div class="metric-value">${data.avgScore}%</div>
              <div class="metric-label">Avg Score</div>
            </div>
          </div>

          <div class="section">
            <h2>🔝 Top Topics</h2>
            <table>
              <tr>
                <th>Topic</th>
                <th>Questions</th>
                <th>Exams</th>
              </tr>
              ${data.topTopics
                .map(
                  (topic) => `
                <tr>
                  <td>${topic.name}</td>
                  <td>${topic.questions}</td>
                  <td>${topic.exams}</td>
                </tr>
              `,
                )
                .join("")}
            </table>
          </div>

          <div class="section">
            <h2>  Alerts</h2>
            <p>${data.alertCount} alerts generated this week</p>
            ${data.criticalAlerts > 0 ? `<p style="color: red;">  ${data.criticalAlerts} critical alerts require attention</p>` : ""}
          </div>

          <div class="section">
            <h2>💾 System Health</h2>
            <ul>
              <li>Storage Used: ${data.storageUsed}GB / ${data.storageTotal}GB</li>
              <li>Active Users: ${data.activeUsers}</li>
              <li>API Calls: ${data.apiCalls.toLocaleString()}</li>
              <li>Avg Response Time: ${data.avgResponseTime}ms</li>
            </ul>
          </div>
        </body>
      </html>
    `;
  }

  async sendContactResponse(to, contactMessage, response) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: `Re: ${contactMessage.subject}`,
        html: `
          <h2>Response to Your Inquiry</h2>
          <p>Dear ${contactMessage.name},</p>
          <p>Thank you for contacting us. Here's our response:</p>
          <div style="background: #f5f5f5; padding: 15px; margin: 15px 0; border-left: 4px solid #4CAF50;">
            ${response}
          </div>
          <p>If you have any further questions, please don't hesitate to reach out.</p>
          <p>Best regards,<br>Vayrex Support Team</p>
          <hr>
          <p style="font-size: 12px; color: #666;">
            <strong>Your Original Message:</strong><br>
            ${contactMessage.message}
          </p>
        `,
      };

      await this._safeSend(mailOptions, "sendContactResponse");
      Logger.info("Contact response sent", { to, contactId: contactMessage._id });
    } catch (err) {
      Logger.error("Contact response error", { error: err.message, to });
      throw err;
    }
  }

  async sendVerificationEmail(to, username, verificationToken, verificationCode) {
    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: "Verify Your Email Address - Vayrex",
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: black; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
                .code-box { background: white; border: 2px dashed #16a34a; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
                .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #16a34a; font-family: 'Courier New', monospace; }
                .divider { text-align: center; margin: 30px 0; color: #999; position: relative; }
                .divider::before { content: ""; position: absolute; left: 0; top: 50%; width: 100%; height: 1px; background: #ddd; }
                .divider span { background: #f9f9f9; padding: 0 15px; position: relative; z-index: 1; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Welcome to Vayrex!  </h1>
                </div>
                <div class="content">
                  <p>Hi <strong>${username}</strong>,</p>
                  <p>Thank you for signing up! We're excited to have you on board.</p>
                  <p>To complete your registration and start using all features, please verify your email address.</p>

                  <h3 style="color: #16a34a; margin-top: 30px;">Option 1: Click to Verify</h3>
                  <p style="text-align: center;">
                    <a href="${verificationUrl}" class="button">Verify Email Address</a>
                  </p>

                  <div class="divider"><span>OR</span></div>

                  <h3 style="color: #16a34a;">Option 2: Enter This Code</h3>
                  <div class="code-box">
                    <p style="margin: 0 0 10px; color: #666; font-size: 14px;">Your Verification Code:</p>
                    <div class="code">${verificationCode}</div>
                  </div>

                  <p style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                    <strong>⏰ This verification will expire in 24 hours.</strong>
                  </p>

                  <p>If you didn't create an account with Vayrex, please ignore this email.</p>
                </div>
                <div class="footer">
                  <p>© ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendVerificationEmail");
      Logger.info("Verification email sent", { to });
    } catch (err) {
      Logger.error("Verification email error", { error: err.message, to });
      throw err;
    }
  }

  async sendPasswordResetEmail(to, username, resetToken, resetCode) {
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: "Reset Your Password - Vayrex",
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #f44336; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #f44336; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
                .code-box { background: white; border: 2px dashed #f44336; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
                .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #f44336; font-family: 'Courier New', monospace; }
                .divider { text-align: center; margin: 30px 0; color: #999; position: relative; }
                .divider::before { content: ""; position: absolute; left: 0; top: 50%; width: 100%; height: 1px; background: #ddd; }
                .divider span { background: #f9f9f9; padding: 0 15px; position: relative; z-index: 1; }
                .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1> Password Reset Request </h1>
                </div>
                <div class="content">
                  <p>Hi <strong>${username}</strong>,</p>
                  <p>We received a request to reset your password for your Vayrex account.</p>

                  <h3 style="color: #f44336; margin-top: 30px;">Option 1: Click to Reset</h3>
                  <p style="text-align: center;">
                    <a href="${resetUrl}" class="button">Reset Password</a>
                  </p>

                  <div class="divider"><span>OR</span></div>

                  <h3 style="color: #f44336;">Option 2: Enter This Code</h3>
                  <div class="code-box">
                    <p style="margin: 0 0 10px; color: #666; font-size: 14px;">Your Reset Code:</p>
                    <div class="code">${resetCode}</div>
                  </div>
                  <div class="warning">
                    <p><strong> Security Notice:</strong></p>
                    <ul>
                      <li>This link will expire in <strong>1 hour</strong></li>
                      <li>If you didn't request this, please ignore this email</li>
                      <li>Your password won't change until you create a new one</li>
                    </ul>
                  </div>
                  <p>If you continue to have problems, please contact our support team.</p>
                </div>
                <div class="footer">
                  <p>© ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendPasswordResetEmail");
      Logger.info("Password reset email sent", { to });
    } catch (err) {
      Logger.error("Password reset email error", { error: err.message, to });
      throw err;
    }
  }

  async sendWelcomeEmail(to, username) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: "Welcome to Vayrex!  ",
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #16a34a 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #4CAF50; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; font-size: 16px; }
                .features { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .feature { display: flex; align-items: start; margin: 15px 0; }
                .feature-icon { font-size: 24px; margin-right: 15px; }
                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; padding: 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1 style="margin: 0; font-size: 32px;">Welcome to Vayrex!  </h1>
                  <p style="margin: 10px 0 0; font-size: 18px; opacity: 0.9;">Your learning journey starts here</p>
                </div>
                <div class="content">
                  <p style="font-size: 16px;">Hi <strong>${username}</strong>,</p>
                  <p>Congratulations! Your email has been verified and your account is now fully activated. We're thrilled to have you join our community of learners.</p>

                  <div class="features">
                    <h3 style="margin-top: 0; color: #16a34a;">Here's what you can do:</h3>

                    <div class="feature">
                      <span class="feature-icon"> </span>
                      <div>
                        <strong>Upload Study Materials</strong>
                        <p style="margin: 5px 0 0; color: #666;">Upload PDFs, Word docs, or PowerPoints and let our AI extract questions</p>
                      </div>
                    </div>

                    <div class="feature">
                      <span class="feature-icon">🎯</span>
                      <div>
                        <strong>Generate Custom Quizzes</strong>
                        <p style="margin: 5px 0 0; color: #666;">Create personalized quizzes from your materials to test your knowledge</p>
                      </div>
                    </div>

                    <div class="feature">
                      <span class="feature-icon"> </span>
                      <div>
                        <strong>Track Your Progress</strong>
                        <p style="margin: 5px 0 0; color: #666;">Monitor your scores, review past quizzes, and identify areas for improvement</p>
                      </div>
                    </div>

                    <div class="feature">
                      <span class="feature-icon">💬</span>
                      <div>
                        <strong>AI Learning Assistant</strong>
                        <p style="margin: 5px 0 0; color: #666;">Chat with our AI to get explanations and clarifications on any topic</p>
                      </div>
                    </div>
                  </div>

                  <p style="text-align: center;">
                    <a href="${process.env.FRONTEND_URL}/dashboard" class="button">Get Started Now</a>
                  </p>

                  <p style="margin-top: 30px; color: #666; font-size: 14px;">Need help getting started? Check out our <a href="${process.env.FRONTEND_URL}/about" style="color: #16a34a;">About page</a> or <a href="${process.env.FRONTEND_URL}/contact" style="color: #16a34a;">contact us</a> anytime.</p>
                </div>
                <div class="footer">
                  <p style="margin: 5px 0;">Happy Learning! 📖</p>
                  <p style="margin: 5px 0;">The Vayrex Team</p>
                  <p style="margin: 15px 0 5px;">&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendWelcomeEmail");
      Logger.info("Welcome email sent", { to });
    } catch (err) {
      Logger.error("Welcome email error", { error: err.message, to });
      throw err;
    }
  }

  async sendContactNotificationToAdmins(contactData) {
    try {
      const User = require("../models/User");
      const admins = await User.find({
        role: { $in: ["admin", "superadmin"] },
        "preferences.emailNotifications": true,
      }).select("email");

      if (admins.length === 0) {
        Logger.warn("No admins with email notifications enabled");
        return;
      }

      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to: admins.map((admin) => admin.email).join(", "),
        subject: `New Contact Form Submission - ${contactData.subject} [${contactData.ticketId}]`,
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #16a34a; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .info-box { background: white; padding: 15px; border-left: 4px solid #16a34a; margin: 15px 0; }
                .label { font-weight: bold; color: #16a34a; margin-top: 10px; }
                .button { display: inline-block; background: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
                .ticket-badge { display: inline-block; background: #e8f4f8; color: #16a34a; padding: 5px 15px; border-radius: 20px; font-weight: bold; font-family: 'Courier New', monospace; margin: 10px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h2 style="margin: 0;">📬 New Contact Form Submission</h2>
                  <div class="ticket-badge">${contactData.ticketId}</div>
                </div>
                <div class="content">
                  <div class="info-box">
                    <div class="label">Ticket ID:</div>
                    <p style="margin: 5px 0; font-family: 'Courier New', monospace; font-size: 18px; color: #16a34a;">${contactData.ticketId}</p>

                    <div class="label">From:</div>
                    <p style="margin: 5px 0;">${contactData.name}</p>

                    <div class="label">Email:</div>
                    <p style="margin: 5px 0;">${contactData.email}</p>

                    <div class="label">Subject:</div>
                    <p style="margin: 5px 0;">${contactData.subject}</p>

                    <div class="label">Message:</div>
                    <p style="margin: 5px 0; white-space: pre-wrap;">${contactData.message}</p>

                    <div class="label">Submitted:</div>
                    <p style="margin: 5px 0;">${new Date(contactData.createdAt).toLocaleString()}</p>

                    <div class="label">Priority:</div>
                    <p style="margin: 5px 0;">${contactData.priority || "medium"}</p>
                  </div>

                  <p style="text-align: center;">
                    <a href="${process.env.FRONTEND_URL}/admin/contacts" class="button">View in Admin Panel</a>
                  </p>

                  <p style="color: #666; font-size: 14px; margin-top: 20px;">Please respond to this inquiry as soon as possible.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendContactNotification");
      Logger.info("Contact notification sent to admins", {
        recipientCount: admins.length,
        contactId: contactData._id,
      });
    } catch (err) {
      Logger.error("Contact notification error", { error: err.message });
      // Don't throw - we don't want to fail the contact submission if notification fails
    }
  }

  async sendContactConfirmation(contactData) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to: contactData.email,
        subject: `Message Received - Ticket ${contactData.ticketId}`,
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #16a34a; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .ticket-box { background: #e8f4f8; border: 2px solid #16a34a; padding: 20px; text-align: center; border-radius: 8px; margin: 25px 0; }
                .ticket-id { font-size: 24px; font-weight: bold; color: #16a34a; font-family: 'Courier New', monospace; letter-spacing: 2px; }
                .info-box { background: white; padding: 15px; border-left: 4px solid #16a34a; margin: 15px 0; }
                .label { font-weight: bold; color: #16a34a; margin-top: 10px; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>✅ Message Received!</h1>
                  <p style="margin: 5px 0;">We've got your message, ${contactData.name}</p>
                </div>
                <div class="content">
                  <p>Thank you for contacting Vayrex! Your message has been successfully received and assigned to our support team.</p>

                  <div class="ticket-box">
                    <p style="margin: 0 0 10px; color: #666; font-size: 14px;">Your Support Ticket ID</p>
                    <div class="ticket-id">${contactData.ticketId}</div>
                    <p style="margin: 10px 0 0; color: #666; font-size: 12px;">Save this for future reference</p>
                  </div>

                  <div class="info-box">
                    <div class="label">Subject:</div>
                    <p style="margin: 5px 0;">${contactData.subject}</p>

                    <div class="label">Your Message:</div>
                    <p style="margin: 5px 0; white-space: pre-wrap;">${contactData.message}</p>

                    <div class="label">Submitted:</div>
                    <p style="margin: 5px 0;">${new Date(contactData.createdAt).toLocaleString()}</p>
                  </div>

                  <h3 style="color: #16a34a;">What happens next?</h3>
                  <ol style="line-height: 1.8;">
                    <li>Our team will review your message</li>
                    <li>You'll receive a response within 24-48 hours</li>
                    <li>Use your ticket ID to track the status</li>
                  </ol>

                  <p style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                    <strong>  Tip:</strong> Keep your ticket ID handy. You can reference it when following up on your inquiry.
                  </p>

                  <p style="color: #666; margin-top: 25px;">If you have any urgent concerns, please don't hesitate to contact us directly.</p>
                </div>
                <div class="footer">
                  <p>© 2026 Vayrex. All rights reserved.</p>
                  <p>This is an automated confirmation. Please do not reply to this email.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendContactConfirmation");
      Logger.info("Contact confirmation sent", {
        to: contactData.email,
        ticketId: contactData.ticketId,
      });
    } catch (err) {
      Logger.error("Contact confirmation error", { error: err.message });
      // Don't throw - we don't want to fail the contact submission if confirmation fails
    }
  }

  async sendAccountDeletionOTP(to, username, otp) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: "  Account Deletion Verification - Vayrex",
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #d32f2f; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .code-box { background: white; border: 3px solid #d32f2f; padding: 25px; text-align: center; border-radius: 8px; margin: 25px 0; }
                .code { font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #d32f2f; font-family: 'Courier New', monospace; }
                .warning { background: #ffebee; border-left: 4px solid #d32f2f; padding: 15px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                .timer { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>  Account Deletion Request</h1>
                </div>
                <div class="content">
                  <p>Hi <strong>${username}</strong>,</p>

                  <div class="warning">
                    <h3 style="margin-top: 0; color: #d32f2f;">IMPORTANT: Permanent Action</h3>
                    <p style="margin: 0;">We received a request to <strong>permanently delete</strong> your Vayrex account. This action cannot be undone.</p>
                  </div>

                  <p>If you initiated this request, please use the verification code below to confirm:</p>

                  <div class="code-box">
                    <p style="margin: 0 0 15px; color: #666; font-size: 14px;">Your Verification Code:</p>
                    <div class="code">${otp}</div>
                  </div>

                  <div class="timer">
                    <strong>This code will expire in 10 minutes.</strong>
                  </div>

                  <h3 style="color: #d32f2f; margin-top: 30px;">What will be deleted:</h3>
                  <ul style="line-height: 1.8;">
                    <li>Your profile and personal information</li>
                    <li>All your uploaded study materials</li>
                    <li>Your exam history and results</li>
                    <li>Saved questions and notes</li>
                    <li>All account data and preferences</li>
                  </ul>

                  <div class="warning">
                    <p style="margin: 0;"><strong>  If you didn't request this:</strong> Please ignore this email and secure your account immediately. Your data is safe.</p>
                  </div>

                  <p style="margin-top: 30px; color: #666;">Need help or changed your mind? Contact our support team.</p>
                </div>
                <div class="footer">
                  <p>© 2026 Vayrex. All rights reserved.</p>
                  <p>This is an automated security email. Please do not reply.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendAccountDeletionOTP");
      Logger.info("Account deletion OTP sent", { to });
    } catch (err) {
      Logger.error("Account deletion OTP error", { error: err.message, to });
      throw err;
    }
  }

  // ===== B2B ORG EMAILS =====

  async sendOrgWelcomeEmail(to, contactName, orgName, setupUrl) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: `Welcome to Vayrex for Schools — Let's set up ${orgName}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #1a1a2e; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">Welcome to Vayrex for Schools</h1>
                  <p style="margin: 8px 0 0; opacity: 0.85;">${orgName} has been registered</p>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p>Hi <strong>${contactName}</strong>,</p>
                  <p>Your school has been successfully registered on Vayrex. Complete the 5-step setup wizard to go live:</p>
                  <ol>
                    <li>Confirm your school URL (slug)</li>
                    <li>Verify your email domain</li>
                    <li>Create your first academic year</li>
                    <li>Set up classrooms and subjects</li>
                    <li>Go live and invite your staff</li>
                  </ol>
                  <p style="text-align: center; margin: 30px 0;">
                    <a href="${setupUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Complete Setup</a>
                  </p>
                  <p style="color: #666; font-size: 13px;">Your school portal will not be active until setup is complete. The setup link is tied to your admin account.</p>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                  <p>&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendOrgWelcomeEmail");
      Logger.info("Org welcome email sent", { to, orgName });
    } catch (err) {
      Logger.error("Org welcome email error", { error: err.message, to });
      throw err;
    }
  }

  async sendInvitationEmail(invite, org) {
    try {
      const inviteUrl = `${process.env.FRONTEND_URL}/Signup?inviteToken=${invite.rawToken}`;
      const roleLabel =
        {
          org_admin: "School Administrator",
          it_admin: "IT Administrator",
          teacher: "Teacher",
          student: "Student",
          guardian: "Parent / Guardian",
        }[invite.orgRole] || invite.orgRole;

      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to: invite.email,
        subject: `You've been invited to join ${org.name} on Vayrex`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #1a1a2e; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">${org.name}</h1>
                  <p style="margin: 8px 0 0; opacity: 0.85;">Invitation to Join</p>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p>You have been invited to join <strong>${org.name}</strong> on Vayrex as a <strong>${roleLabel}</strong>.</p>
                  <p>Click the button below to create your account and accept the invitation:</p>
                  <p style="text-align: center; margin: 30px 0;">
                    <a href="${inviteUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Accept Invitation</a>
                  </p>
                  <p style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0;">
                    <strong>This invitation expires in 7 days.</strong> If you did not expect this, you can safely ignore it.
                  </p>
                  <p style="color: #666; font-size: 13px;">If the button doesn't work, copy this link into your browser:<br><a href="${inviteUrl}" style="color: #16a34a; word-break: break-all;">${inviteUrl}</a></p>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                  <p>&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendInvitationEmail");
      Logger.info("Org invitation email sent", {
        to: invite.email,
        orgId: org._id,
        role: invite.orgRole,
      });
    } catch (err) {
      Logger.error("Org invitation email error", { error: err.message, to: invite.email });
      throw err;
    }
  }

  async sendGuardianInviteEmail(invite, studentName, org) {
    try {
      const inviteUrl = `${process.env.FRONTEND_URL}/Signup?inviteToken=${invite.rawToken}&guardianCode=${invite.guardianCode}`;

      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to: invite.email,
        subject: `Parent / Guardian invitation — ${studentName} at ${org.name}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #1a1a2e; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">${org.name}</h1>
                  <p style="margin: 8px 0 0; opacity: 0.85;">Guardian Portal Invitation</p>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p>You have been invited to create a guardian account for <strong>${studentName}</strong> at <strong>${org.name}</strong>.</p>
                  <p>Through your guardian portal you can:</p>
                  <ul>
                    <li>View your child's report cards and grades</li>
                    <li>Monitor attendance records</li>
                    <li>Track academic progress term-by-term</li>
                  </ul>
                  <p style="text-align: center; margin: 30px 0;">
                    <a href="${inviteUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Create Guardian Account</a>
                  </p>
                  <div style="background: white; border: 2px dashed #4CAF50; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0 0 5px; color: #666; font-size: 13px;">Your Guardian Code (keep this safe)</p>
                    <p style="margin: 0; font-size: 22px; font-weight: bold; letter-spacing: 4px; font-family: 'Courier New', monospace; color: #4CAF50;">${invite.guardianCode}</p>
                  </div>
                  <p style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0;">
                    <strong>This invitation expires in 7 days.</strong>
                  </p>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                  <p>&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendGuardianInviteEmail");
      Logger.info("Guardian invite email sent", {
        to: invite.email,
        orgId: org._id,
        studentName,
      });
    } catch (err) {
      Logger.error("Guardian invite email error", { error: err.message, to: invite.email });
      throw err;
    }
  }

  async sendBulkInviteStatus(to, adminName, orgName, results) {
    try {
      const { sent = [], skipped = [], failed = [] } = results;
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: `Bulk invite complete — ${orgName}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #1a1a2e; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h2 style="margin: 0;">Bulk Invite Summary</h2>
                  <p style="margin: 6px 0 0; opacity: 0.8;">${orgName}</p>
                </div>
                <div style="background: #f9f9f9; padding: 28px; border-radius: 0 0 8px 8px;">
                  <p>Hi <strong>${adminName}</strong>, your bulk invitation job has completed.</p>
                  <div style="display: flex; gap: 16px; flex-wrap: wrap; margin: 20px 0;">
                    <div style="flex: 1; min-width: 120px; background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
                      <div style="font-size: 28px; font-weight: 800; color: #2e7d32;">${sent.length}</div>
                      <div style="font-size: 13px; color: #555;">Sent</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: #fff8e1; border-radius: 8px; padding: 16px; text-align: center;">
                      <div style="font-size: 28px; font-weight: 800; color: #f9a825;">${skipped.length}</div>
                      <div style="font-size: 13px; color: #555;">Skipped</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: #fce4ec; border-radius: 8px; padding: 16px; text-align: center;">
                      <div style="font-size: 28px; font-weight: 800; color: #c62828;">${failed.length}</div>
                      <div style="font-size: 13px; color: #555;">Failed</div>
                    </div>
                  </div>
                  ${
                    failed.length > 0
                      ? `
                  <div style="background: white; border-left: 4px solid #f44336; padding: 14px; border-radius: 4px; margin-top: 20px;">
                    <p style="margin: 0 0 8px; font-weight: 600; font-size: 14px;">Failed rows:</p>
                    ${failed
                      .slice(0, 10)
                      .map(
                        (f) =>
                          `<p style="margin: 4px 0; font-size: 13px; font-family: monospace;">${f.email} — ${f.reason}</p>`,
                      )
                      .join("")}
                    ${failed.length > 10 ? `<p style="font-size: 12px; color: #999;">...and ${failed.length - 10} more</p>` : ""}
                  </div>`
                      : ""
                  }
                </div>
                <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">&copy; ${new Date().getFullYear()} Vayrex</div>
              </div>
            </body>
          </html>
        `,
      };
      await this._safeSend(mailOptions, "sendBulkInviteStatus");
      Logger.info("Bulk invite status email sent", {
        to,
        sent: sent.length,
        failed: failed.length,
      });
    } catch (err) {
      Logger.error("Bulk invite status email error", { error: err.message, to });
      // Non-fatal — do not rethrow
    }
  }

  async sendSeatAssignedEmail(userEmail, userName, org) {
    try {
      const portalUrl = `${process.env.FRONTEND_URL}/Dashboard`;

      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to: userEmail,
        subject: `You now have access to ${org.name} on Vayrex`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #1a1a2e; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">${org.name}</h1>
                  <p style="margin: 8px 0 0; opacity: 0.85;">Seat Confirmed</p>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p>Hi <strong>${userName}</strong>,</p>
                  <p>A seat at <strong>${org.name}</strong> has been assigned to your Vayrex account. You now have full access to your organisation's portal.</p>
                  <p style="text-align: center; margin: 30px 0;">
                    <a href="${portalUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Go to Dashboard</a>
                  </p>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                  <p>&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendSeatAssignedEmail");
      Logger.info("Seat assigned email sent", { to: userEmail, orgId: org._id });
    } catch (err) {
      Logger.error("Seat assigned email error", { error: err.message, to: userEmail });
      throw err;
    }
  }
  async sendAttendanceAlertEmail(to, guardianName, studentName, percentage, threshold, orgName) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: `Attendance Alert for ${studentName} — ${orgName}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #dc2626; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">${orgName}</h1>
                  <p style="margin: 8px 0 0; opacity: 0.85;">Attendance Alert</p>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p>Dear <strong>${guardianName}</strong>,</p>
                  <p>We would like to inform you that <strong>${studentName}</strong>'s attendance has dropped to <strong style="color: #dc2626;">${percentage}%</strong>, which is below the required minimum of <strong>${threshold}%</strong>.</p>
                  <p>Regular attendance is essential for academic success. Please ensure your ward attends school consistently.</p>
                  <p>If there are circumstances affecting attendance, kindly contact the school administration.</p>
                  <p style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL}/guardian-portal" style="display: inline-block; background: #1a1a2e; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">View Attendance</a>
                  </p>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                  <p>&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendAttendanceAlertEmail");
      Logger.info("Attendance alert email sent", { to, studentName, percentage });
    } catch (err) {
      Logger.error("Attendance alert email error", { error: err.message, to });
      throw err;
    }
  }

  async sendReportCardEmail(to, recipientName, studentName, termName, orgName, downloadUrl) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || "noreply@madebyovo.me",
        to,
        subject: `Report Card Ready — ${studentName} (${termName}) — ${orgName}`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: #1a1a2e; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">${orgName}</h1>
                  <p style="margin: 8px 0 0; opacity: 0.85;">Report Card Published</p>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p>Dear <strong>${recipientName}</strong>,</p>
                  <p>The <strong>${termName}</strong> report card for <strong>${studentName}</strong> has been published and is now available for viewing.</p>
                  ${downloadUrl ? `<p style="text-align: center; margin: 30px 0;"><a href="${downloadUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Download Report Card</a></p>` : ""}
                  <p style="text-align: center; margin: 20px 0;">
                    <a href="${process.env.FRONTEND_URL}/guardian-portal" style="display: inline-block; background: #1a1a2e; color: white; padding: 14px 35px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">View on Portal</a>
                  </p>
                </div>
                <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
                  <p>&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      await this._safeSend(mailOptions, "sendReportCardEmail");
      Logger.info("Report card email sent", { to, studentName, termName });
    } catch (err) {
      Logger.error("Report card email error", { error: err.message, to });
      throw err;
    }
  }
}

// Export singleton instance of EmailService
module.exports = new EmailService();
