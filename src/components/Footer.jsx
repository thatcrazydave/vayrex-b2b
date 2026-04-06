import React from 'react';
import { Link } from 'react-router-dom';
import { FiTwitter, FiLinkedin, FiGithub } from 'react-icons/fi';
import '../styles/footer.css';
import { useTenant } from '../contexts/TenantContext.jsx';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const { tenant, isTenantHost } = useTenant();

  const branding    = tenant?.branding ?? {};
  const displayName = branding.displayName || tenant?.name;
  const accentColor = branding.accentColor || 'var(--brand-accent, #10b981)';
  const hideVayrex  = branding.hideVayrexBranding;

  // ── Tenant host: minimal footer with school name + "Powered by Vayrex" ──
  if (isTenantHost && tenant) {
    return (
      <footer className="footer" style={{ padding: '24px 0' }}>
        <div className="footer-container">
          <div className="footer-bottom">
            <div className="footer-bottom-content" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <p className="footer-copyright">
                &copy; {currentYear} {displayName}. All rights reserved.
              </p>
              {!hideVayrex && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #94a3b8)' }}>
                  Powered by{' '}
                  <a
                    href="https://madebyovo.me"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: accentColor, fontWeight: 600, textDecoration: 'none' }}
                  >
                    Vayrex
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      </footer>
    );
  }

  // ── Platform host: full footer ───────────────────────────────────────────
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-top">
          <div className="footer-column footer-brand">
            <h3 className="footer-heading">Vayrex</h3>
            <p className="footer-tagline">AI-powered educational management system for schools. Manage classes, grades, attendance, and more.</p>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Product</h3>
            <ul className="footer-links">
              <li><Link to="/org-signup">Register Your School</Link></li>
              <li><Link to="/pricing">Pricing</Link></li>
              <li><Link to="/about">About</Link></li>
            </ul>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Company</h3>
            <ul className="footer-links">
              <li><Link to="/about">About</Link></li>
              <li><Link to="/contact">Contact</Link></li>
            </ul>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Legal</h3>
            <ul className="footer-links">
              <li><a href="#privacy">Privacy Policy</a></li>
              <li><a href="#terms">Terms of Service</a></li>
              <li><a href="#cookies">Cookie Policy</a></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-bottom-content">
            <p className="footer-copyright">
              &copy; {currentYear} Vayrex. All rights reserved.
            </p>
            <div className="footer-social">
              <a href="#twitter" aria-label="Twitter" className="social-link">
                <FiTwitter size={18} />
              </a>
              <a href="#linkedin" aria-label="LinkedIn" className="social-link">
                <FiLinkedin size={18} />
              </a>
              <a href="#github" aria-label="GitHub" className="social-link">
                <FiGithub size={18} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
