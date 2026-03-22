const nodemailer = require('nodemailer');
const Logger = require('../logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      // Fail fast instead of hanging indefinitely
      connectionTimeout: 10000,  // 10s to establish TCP connection
      greetingTimeout: 10000,    // 10s to receive SMTP greeting
      socketTimeout: 15000       // 15s idle socket timeout
    });

    // Non-fatal startup check — logs a warning if SMTP is unreachable
    // so you know immediately without crashing the server
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.transporter.verify().then(() => {
        Logger.info('SMTP connection verified successfully');
      }).catch(err => {
        Logger.warn('SMTP connection check failed — emails may not send', { error: err.message });
      });
    } else {
      Logger.warn('SMTP credentials (SMTP_USER / SMTP_PASS) not configured — emails disabled');
    }

    // Rate limiting: track emails sent per recipient per hour
    this._emailLog = new Map(); // email -> [timestamps]
    this._maxPerHour = 5;      // max 5 emails per recipient per hour
    this._cleanupInterval = setInterval(() => this._cleanupLog(), 3600000); // cleanup hourly
  }

  // Rate limiting check
  _isRateLimited(to) {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const emails = to.split(',').map(e => e.trim());

    for (const email of emails) {
      const log = this._emailLog.get(email) || [];
      const recentSends = log.filter(ts => ts > hourAgo);
      if (recentSends.length >= this._maxPerHour) {
        Logger.warn('Email rate limited', { email, recentSends: recentSends.length });
        return true;
      }
    }
    return false;
  }

  _recordSend(to) {
    const now = Date.now();
    const emails = to.split(',').map(e => e.trim());
    for (const email of emails) {
      const log = this._emailLog.get(email) || [];
      log.push(now);
      this._emailLog.set(email, log);
    }
  }

  _cleanupLog() {
    const hourAgo = Date.now() - 3600000;
    for (const [email, timestamps] of this._emailLog) {
      const recent = timestamps.filter(ts => ts > hourAgo);
      if (recent.length === 0) this._emailLog.delete(email);
      else this._emailLog.set(email, recent);
    }
  }

  // Validate email before sending
  _validateEmail(to) {
    if (!to || typeof to !== 'string' || to.trim() === '') {
      Logger.error('Email send attempted with empty recipient');
      return false;
    }
    const emails = to.split(',').map(e => e.trim());
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emails.every(e => emailRegex.test(e));
  }

  // Safe send with validation, rate limiting, and a hard 20s timeout
  async _safeSend(mailOptions, context = '') {
    if (!this._validateEmail(mailOptions.to)) {
      Logger.error('Invalid email recipient', { to: mailOptions.to, context });
      throw new Error('Invalid email recipient');
    }
    if (this._isRateLimited(mailOptions.to)) {
      Logger.warn('Email rate limited, skipping', { to: mailOptions.to, context });
      return; // silently skip rate-limited emails
    }

    // Hard timeout: if SMTP hangs, reject after 20s rather than blocking indefinitely
    const sendWithTimeout = Promise.race([
      this.transporter.sendMail(mailOptions),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP send timed out after 20s')), 20000)
      )
    ]);

    await sendWithTimeout;
    this._recordSend(mailOptions.to);
    Logger.info(`Email sent: ${context}`, { to: mailOptions.to });
  }

  async sendAlertEmail(to, alert) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to,
        subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        html: `
          <h2>System Alert</h2>
          <p><strong>Type:</strong> ${alert.type}</p>
          <p><strong>Severity:</strong> ${alert.severity}</p>
          <p><strong>Message:</strong> ${alert.message}</p>
          <p><strong>Time:</strong> ${new Date(alert.createdAt).toLocaleString()}</p>
          ${alert.details ? `<pre>${JSON.stringify(alert.details, null, 2)}</pre>` : ''}
          <p><a href="${process.env.FRONTEND_URL}/admin/alerts/${alert._id}">View Alert</a></p>
        `
      };

      await this._safeSend(mailOptions, 'sendAlertEmail');
      Logger.info('Alert email sent', { to, alertId: alert._id });
    } catch (err) {
      Logger.error('Email send error', { error: err.message, to });
      throw err;
    }
  }

  async sendWeeklyReport(to, reportData) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to,
        subject: `Weekly System Report - ${new Date().toLocaleDateString()}`,
        html: this.generateWeeklyReportHTML(reportData)
      };

      await this._safeSend(mailOptions, 'sendWeeklyReport');
      Logger.info('Weekly report sent', { to });
    } catch (err) {
      Logger.error('Weekly report error', { error: err.message, to });
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
              ${data.topTopics.map(topic => `
                <tr>
                  <td>${topic.name}</td>
                  <td>${topic.questions}</td>
                  <td>${topic.exams}</td>
                </tr>
              `).join('')}
            </table>
          </div>
          
          <div class="section">
            <h2>  Alerts</h2>
            <p>${data.alertCount} alerts generated this week</p>
            ${data.criticalAlerts > 0 ? `<p style="color: red;">  ${data.criticalAlerts} critical alerts require attention</p>` : ''}
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
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
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
        `
      };

      await this._safeSend(mailOptions, 'sendContactResponse');
      Logger.info('Contact response sent', { to, contactId: contactMessage._id });
    } catch (err) {
      Logger.error('Contact response error', { error: err.message, to });
      throw err;
    }
  }

  async sendVerificationEmail(to, username, verificationToken, verificationCode) {
    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to,
        subject: 'Verify Your Email Address - Vayrex',
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: black; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
                .code-box { background: white; border: 2px dashed #667eea; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
                .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea; font-family: 'Courier New', monospace; }
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
                  
                  <h3 style="color: #667eea; margin-top: 30px;">Option 1: Click to Verify</h3>
                  <p style="text-align: center;">
                    <a href="${verificationUrl}" class="button">Verify Email Address</a>
                  </p>
                  
                  <div class="divider"><span>OR</span></div>
                  
                  <h3 style="color: #667eea;">Option 2: Enter This Code</h3>
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
        `
      };

      await this._safeSend(mailOptions, 'sendVerificationEmail');
      Logger.info('Verification email sent', { to });
    } catch (err) {
      Logger.error('Verification email error', { error: err.message, to });
      throw err;
    }
  }

  async sendPasswordResetEmail(to, username, resetToken, resetCode) {
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to,
        subject: 'Reset Your Password - Vayrex',
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
        `
      };

      await this._safeSend(mailOptions, 'sendPasswordResetEmail');
      Logger.info('Password reset email sent', { to });
    } catch (err) {
      Logger.error('Password reset email error', { error: err.message, to });
      throw err;
    }
  }

  async sendWelcomeEmail(to, username) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to,
        subject: 'Welcome to Vayrex!  ',
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0; }
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
                    <h3 style="margin-top: 0; color: #667eea;">Here's what you can do:</h3>
                    
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
                  
                  <p style="margin-top: 30px; color: #666; font-size: 14px;">Need help getting started? Check out our <a href="${process.env.FRONTEND_URL}/about" style="color: #667eea;">About page</a> or <a href="${process.env.FRONTEND_URL}/contact" style="color: #667eea;">contact us</a> anytime.</p>
                </div>
                <div class="footer">
                  <p style="margin: 5px 0;">Happy Learning! 📖</p>
                  <p style="margin: 5px 0;">The Vayrex Team</p>
                  <p style="margin: 15px 0 5px;">&copy; ${new Date().getFullYear()} Vayrex. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `
      };

      await this._safeSend(mailOptions, 'sendWelcomeEmail');
      Logger.info('Welcome email sent', { to });
    } catch (err) {
      Logger.error('Welcome email error', { error: err.message, to });
      throw err;
    }
  }

  async sendContactNotificationToAdmins(contactData) {
    try {
      const User = require('../models/User');
      const admins = await User.find({
        role: { $in: ['admin', 'superadmin'] },
        'preferences.emailNotifications': true
      }).select('email');

      if (admins.length === 0) {
        Logger.warn('No admins with email notifications enabled');
        return;
      }

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to: admins.map(admin => admin.email).join(', '),
        subject: `New Contact Form Submission - ${contactData.subject} [${contactData.ticketId}]`,
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #667eea; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .info-box { background: white; padding: 15px; border-left: 4px solid #667eea; margin: 15px 0; }
                .label { font-weight: bold; color: #667eea; margin-top: 10px; }
                .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
                .ticket-badge { display: inline-block; background: #e8f4f8; color: #667eea; padding: 5px 15px; border-radius: 20px; font-weight: bold; font-family: 'Courier New', monospace; margin: 10px 0; }
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
                    <p style="margin: 5px 0; font-family: 'Courier New', monospace; font-size: 18px; color: #667eea;">${contactData.ticketId}</p>
                    
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
                    <p style="margin: 5px 0;">${contactData.priority || 'medium'}</p>
                  </div>
                  
                  <p style="text-align: center;">
                    <a href="${process.env.FRONTEND_URL}/admin/contacts" class="button">View in Admin Panel</a>
                  </p>
                  
                  <p style="color: #666; font-size: 14px; margin-top: 20px;">Please respond to this inquiry as soon as possible.</p>
                </div>
              </div>
            </body>
          </html>
        `
      };

      await this._safeSend(mailOptions, 'sendContactNotification');
      Logger.info('Contact notification sent to admins', {
        recipientCount: admins.length,
        contactId: contactData._id
      });
    } catch (err) {
      Logger.error('Contact notification error', { error: err.message });
      // Don't throw - we don't want to fail the contact submission if notification fails
    }
  }

  async sendContactConfirmation(contactData) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to: contactData.email,
        subject: `Message Received - Ticket ${contactData.ticketId}`,
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #667eea; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                .ticket-box { background: #e8f4f8; border: 2px solid #667eea; padding: 20px; text-align: center; border-radius: 8px; margin: 25px 0; }
                .ticket-id { font-size: 24px; font-weight: bold; color: #667eea; font-family: 'Courier New', monospace; letter-spacing: 2px; }
                .info-box { background: white; padding: 15px; border-left: 4px solid #667eea; margin: 15px 0; }
                .label { font-weight: bold; color: #667eea; margin-top: 10px; }
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
                  
                  <h3 style="color: #667eea;">What happens next?</h3>
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
        `
      };

      await this._safeSend(mailOptions, 'sendContactConfirmation');
      Logger.info('Contact confirmation sent', {
        to: contactData.email,
        ticketId: contactData.ticketId
      });
    } catch (err) {
      Logger.error('Contact confirmation error', { error: err.message });
      // Don't throw - we don't want to fail the contact submission if confirmation fails
    }
  }

  async sendAccountDeletionOTP(to, username, otp) {
    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@vayrex.com',
        to,
        subject: '  Account Deletion Verification - Vayrex',
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
        `
      };

      await this._safeSend(mailOptions, 'sendAccountDeletionOTP');
      Logger.info('Account deletion OTP sent', { to });
    } catch (err) {
      Logger.error('Account deletion OTP error', { error: err.message, to });
      throw err;
    }
  }
}

// Export singleton instance of EmailService
module.exports = new EmailService();