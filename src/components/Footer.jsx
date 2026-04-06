import React from 'react';
import { Link } from 'react-router-dom';
import { FiTwitter, FiLinkedin, FiGithub } from 'react-icons/fi';
import '../styles/footer.css';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-container">
        {/* Footer Top Section */}
        <div className="footer-top">
          {/* Brand */}
          <div className="footer-column footer-brand">
            <h3 className="footer-heading">Vayrex</h3>
            <p className="footer-tagline">AI-powered educational management system for schools. Manage classes, grades, attendance, and more.</p>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Product</h3>
            <ul className="footer-links">
              <li><Link to="/for-schools">For Schools</Link></li>
              <li><Link to="/org-signup">Register School</Link></li>
              <li><Link to="/pricing">Pricing</Link></li>
              <li><Link to="/about">About</Link></li>
            </ul>
          </div>

          <div className="footer-column">
            <h3 className="footer-heading">Company</h3>
            <ul className="footer-links">
              <li><Link to="/about">About</Link></li>
              <li><Link to="/contact">Contact</Link></li>
              <li><Link to="/settings">Settings</Link></li>
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

        {/* Footer Bottom Section */}
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
