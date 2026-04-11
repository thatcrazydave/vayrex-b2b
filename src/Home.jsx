import React from 'react';
import { Link } from 'react-router-dom';
import './styles/home.css';
import {
  FiCheckCircle, FiUsers, FiTrendingUp, FiBook, FiShield, FiArrowRight,
  FiZap, FiAward, FiBarChart2, FiLayers, FiGrid, FiMail
} from 'react-icons/fi';

function Home() {
  // Note: authenticated org members are redirected to their tenant subdomain
  // in PlatformRoutes before this component ever renders.

  return (
    <div className="home-container">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-decoration" aria-hidden="true">
          <div className="deco-circle"></div>
          <div className="deco-circle"></div>
          <div className="deco-dot-grid"></div>
        </div>
        <div className="container">
          <div className="hero-content">
            <div className="hero-text">
              <div className="hero-badge">
                <FiZap size={12} />
                <span>AI-Powered School EMS</span>
              </div>
              <h1 className="hero-title">
                Run Your School<br />
                Smarter with <span className="brand-name">Vayrex</span>
              </h1>
              <p className="hero-subtitle">
                The complete educational management system for secondary schools.
                AI-generated questions and notes, digital grade books, report cards,
                attendance tracking, and a guardian portal — all in one platform.
              </p>
              <div className="hero-buttons">
                <div className="button-group">
                  <Link to="/org-signup" className="btn btn-primary btn-large">
                    Register Your School <FiArrowRight size={16} />
                  </Link>
                  <Link to="/pricing" className="btn btn-outline btn-large">
                    See Pricing
                  </Link>
                </div>
              </div>
              <div className="trust-section">
                <div className="trust-item">
                  <span className="trust-number">500+</span>
                  <span className="trust-label">Schools</span>
                </div>
                <div className="trust-divider"></div>
                <div className="trust-item">
                  <span className="trust-number">200K+</span>
                  <span className="trust-label">Students Managed</span>
                </div>
                <div className="trust-divider"></div>
                <div className="trust-item">
                  <span className="trust-number">98%</span>
                  <span className="trust-label">Admin Time Saved</span>
                </div>
              </div>
            </div>
            <div className="hero-visual">
              <div className="mockup-window">
                <div className="mockup-topbar">
                  <div className="mockup-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <div className="mockup-title">Principal Dashboard</div>
                  <div className="mockup-actions"></div>
                </div>
                <div className="mockup-body">
                  <div className="mockup-stats">
                    <div className="mockup-stat">
                      <div className="mockup-stat-icon"><FiUsers size={14} /></div>
                      <div>
                        <div className="mockup-stat-value">483</div>
                        <div className="mockup-stat-label">Enrolled</div>
                      </div>
                    </div>
                    <div className="mockup-stat">
                      <div className="mockup-stat-icon"><FiBarChart2 size={14} /></div>
                      <div>
                        <div className="mockup-stat-value">91%</div>
                        <div className="mockup-stat-label">Attendance</div>
                      </div>
                    </div>
                    <div className="mockup-stat">
                      <div className="mockup-stat-icon"><FiAward size={14} /></div>
                      <div>
                        <div className="mockup-stat-value">18</div>
                        <div className="mockup-stat-label">Classes</div>
                      </div>
                    </div>
                  </div>
                  <div className="mockup-progress-section">
                    <div className="mockup-progress-header">
                      <span>Term Progress — First Term</span>
                      <span className="mockup-badge">Active</span>
                    </div>
                    <div className="mockup-progress-bar">
                      <div className="mockup-progress-fill"></div>
                    </div>
                  </div>
                  <div className="mockup-questions">
                    <div className="mockup-question">
                      <div className="mockup-q-dot correct"></div>
                      <span>JSS1A — Grade book published</span>
                      <span className="mockup-q-badge">✓</span>
                    </div>
                    <div className="mockup-question">
                      <div className="mockup-q-dot correct"></div>
                      <span>SS2B — Report cards ready</span>
                      <span className="mockup-q-badge">✓</span>
                    </div>
                    <div className="mockup-question active">
                      <div className="mockup-q-dot active-dot"></div>
                      <span>SS3A — Awaiting grades</span>
                      <span className="mockup-q-badge active-badge">→</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="floating-card floating-card-1">
                <div className="floating-card-icon"><FiMail size={14} /></div>
                <div>
                  <strong>Guardian Notified</strong>
                  <span>Report card published</span>
                </div>
              </div>
              <div className="floating-card floating-card-2">
                <div className="floating-card-icon success"><FiCheckCircle size={14} /></div>
                <div>
                  <strong>Term Closed</strong>
                  <span>Data archived to S3</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section">
        <div className="container">
          <div className="section-header">
            <div className="section-badge">Features</div>
            <h2>Everything your school needs in one place</h2>
            <p>Purpose-built for Nigerian secondary schools — JSS1 to SS3 — with the flexibility to fit any school structure</p>
          </div>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon"><FiLayers size={22} /></div>
              <h3>Academic Management</h3>
              <p>Academic years, terms, classes, and subjects — fully configurable. Create JSS1–SS3 structures or any custom class hierarchy.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon"><FiBook size={22} /></div>
              <h3>AI-Powered Classrooms</h3>
              <p>Teachers generate questions and notes from uploaded documents. AI handles the content; teachers focus on teaching.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon"><FiTrendingUp size={22} /></div>
              <h3>Grade Books & Report Cards</h3>
              <p>Digital grade entry with automatic CA/Exam computation. Report cards generated as PDFs and sent directly to guardians.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon"><FiCheckCircle size={22} /></div>
              <h3>Attendance Tracking</h3>
              <p>Digital or Excel-upload attendance. Automated alerts when a student's attendance falls below threshold.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon"><FiUsers size={22} /></div>
              <h3>Guardian Portal</h3>
              <p>Parents see their child's grades, attendance, report cards, and assignments — real-time, on any device.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon"><FiShield size={22} /></div>
              <h3>Fully Isolated & Secure</h3>
              <p>Every school gets its own private subdomain and zero-bleed data isolation. No school can see another's data.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="process-section">
        <div className="container">
          <div className="section-header">
            <div className="section-badge">How It Works</div>
            <h2>Up and running in minutes</h2>
            <p>No IT department required — the setup wizard walks you through everything</p>
          </div>
          <div className="process-steps">
            <div className="step">
              <div className="step-number">01</div>
              <div className="step-content">
                <h3>Register Your School</h3>
                <p>Enter your school details, choose a subdomain, and get your private Vayrex portal — e.g. <em>yourschool.madebyovo.me</em>.</p>
              </div>
            </div>
            <div className="step">
              <div className="step-number">02</div>
              <div className="step-content">
                <h3>Configure Your Academic Structure</h3>
                <p>Set up academic years, terms, classes, and subjects through a guided wizard. Invite teachers and enroll students.</p>
              </div>
            </div>
            <div className="step">
              <div className="step-number">03</div>
              <div className="step-content">
                <h3>Go Live</h3>
                <p>Your school is live. Teachers start generating materials, students take AI-powered exams, guardians stay informed automatically.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2>Ready to bring your school into the future?</h2>
            <p>Join hundreds of schools already running on Vayrex. Free setup, no lock-in.</p>
            <div className="cta-buttons">
              <Link to="/org-signup" className="btn btn-primary btn-large">
                Register Your School <FiArrowRight size={16} />
              </Link>
              <Link to="/contact" className="btn btn-outline btn-large">
                Talk to Sales
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;