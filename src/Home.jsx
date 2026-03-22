import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import './styles/home.css';
import { FiCheckCircle, FiFileText, FiTrendingUp, FiClock, FiStar, FiLock, FiArrowRight, FiUpload, FiZap, FiTarget, FiAward, FiBarChart2 } from 'react-icons/fi';

function Home() {
  const { isAuthenticated } = useAuth();
  const name = "Vayrex";

  return (
    <div className="home-container">
      {/* Hero Section */}
      <section className="hero-section">
        {/* Floating geometric decorations */}
        <div className="hero-decoration" aria-hidden="true">
          <div className="deco-circle"></div>
          <div className="deco-circle"></div>
          <div className="deco-circle"></div>
          <div className="deco-dot-grid"></div>
        </div>
        <div className="container">
          <div className="hero-content">
            <div className="hero-text">
              <div className="hero-badge">
                <FiZap size={12} />
                <span>AI-Powered Learning Platform</span>
              </div>
              <h1 className="hero-title">
                Master Any Subject<br />
                with <span className="brand-name">{name}</span>
              </h1>
              <p className="hero-subtitle">
                Transform your documents into personalized learning experiences.
                Our AI generates smart questions, tracks your progress, and adapts
                to how you learn.
              </p>
              <div className="hero-buttons">
                {isAuthenticated ? (
                  <div className="button-group">
                    <Link to="/learn" className="btn btn-primary btn-large">
                      Start Learning <FiArrowRight size={16} />
                    </Link>
                    <Link to="/Dashboard" className="btn btn-secondary btn-large">
                      View Dashboard
                    </Link>
                  </div>
                ) : (
                  <div className="button-group">
                    <Link to="/Signup" className="btn btn-primary btn-large">
                      Get Started Free <FiArrowRight size={16} />
                    </Link>
                    <Link to="/Login" className="btn btn-outline btn-large">
                      Sign In
                    </Link>
                  </div>
                )}
              </div>
              {/* Trust Indicators */}
              <div className="trust-section">
                <div className="trust-item">
                  <span className="trust-number">1,000+</span>
                  <span className="trust-label">Students</span>
                </div>
                <div className="trust-divider"></div>
                <div className="trust-item">
                  <span className="trust-number">50K+</span>
                  <span className="trust-label">Questions Generated</span>
                </div>
                <div className="trust-divider"></div>
                <div className="trust-item">
                  <span className="trust-number">98%</span>
                  <span className="trust-label">Satisfaction Rate</span>
                </div>
              </div>
            </div>
            <div className="hero-visual">
              {/* App Mockup Dashboard */}
              <div className="mockup-window">
                <div className="mockup-topbar">
                  <div className="mockup-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <div className="mockup-title">Vayrex Dashboard</div>
                  <div className="mockup-actions"></div>
                </div>
                <div className="mockup-body">
                  <div className="mockup-stats">
                    <div className="mockup-stat">
                      <div className="mockup-stat-icon"><FiBarChart2 size={14} /></div>
                      <div>
                        <div className="mockup-stat-value">87%</div>
                        <div className="mockup-stat-label">Avg Score</div>
                      </div>
                    </div>
                    <div className="mockup-stat">
                      <div className="mockup-stat-icon"><FiTarget size={14} /></div>
                      <div>
                        <div className="mockup-stat-value">142</div>
                        <div className="mockup-stat-label">Questions</div>
                      </div>
                    </div>
                    <div className="mockup-stat">
                      <div className="mockup-stat-icon"><FiAward size={14} /></div>
                      <div>
                        <div className="mockup-stat-value">12</div>
                        <div className="mockup-stat-label">Topics</div>
                      </div>
                    </div>
                  </div>
                  <div className="mockup-progress-section">
                    <div className="mockup-progress-header">
                      <span>Document Analysis</span>
                      <span className="mockup-badge">Complete</span>
                    </div>
                    <div className="mockup-progress-bar">
                      <div className="mockup-progress-fill"></div>
                    </div>
                  </div>
                  <div className="mockup-questions">
                    <div className="mockup-question">
                      <div className="mockup-q-dot correct"></div>
                      <span>What is the primary function of...</span>
                      <span className="mockup-q-badge">✓</span>
                    </div>
                    <div className="mockup-question">
                      <div className="mockup-q-dot correct"></div>
                      <span>Explain the relationship between...</span>
                      <span className="mockup-q-badge">✓</span>
                    </div>
                    <div className="mockup-question active">
                      <div className="mockup-q-dot active-dot"></div>
                      <span>How does this concept apply to...</span>
                      <span className="mockup-q-badge active-badge">→</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Floating notification cards */}
              <div className="floating-card floating-card-1">
                <div className="floating-card-icon"><FiUpload size={14} /></div>
                <div>
                  <strong>PDF Uploaded</strong>
                  <span>Biology_Notes.pdf</span>
                </div>
              </div>
              <div className="floating-card floating-card-2">
                <div className="floating-card-icon success"><FiCheckCircle size={14} /></div>
                <div>
                  <strong>15 Questions Ready</strong>
                  <span>Start practicing now</span>
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
            <h2>Everything you need to learn smarter</h2>
            <p>Powerful tools designed to transform how you study and retain information</p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <FiCheckCircle size={22} />
              </div>
              <h3>AI Document Analysis</h3>
              <p>Advanced machine learning algorithms extract key concepts and generate intelligent questions from your uploaded materials.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <FiFileText size={22} />
              </div>
              <h3>Smart Question Generation</h3>
              <p>Automatically create comprehensive question sets with multiple difficulty levels and various question types.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <FiTrendingUp size={22} />
              </div>
              <h3>Progress Analytics</h3>
              <p>Detailed insights into your learning patterns, strengths, and areas for improvement with actionable recommendations.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <FiClock size={22} />
              </div>
              <h3>Adaptive Learning</h3>
              <p>Dynamic difficulty adjustment based on your performance ensures optimal challenge level for maximum retention.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <FiStar size={22} />
              </div>
              <h3>Performance Tracking</h3>
              <p>Monitor your progress with detailed statistics, performance trends, and personalized learning recommendations.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <FiLock size={22} />
              </div>
              <h3>Secure Platform</h3>
              <p>Enterprise-grade security with end-to-end encryption ensures your data and learning materials remain private.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Process Section */}
      <section className="process-section">
        <div className="container">
          <div className="section-header">
            <div className="section-badge">How It Works</div>
            <h2>Three steps to mastery</h2>
            <p>Simple, efficient, and effective learning process</p>
          </div>

          <div className="process-steps">
            <div className="step">
              <div className="step-number">01</div>
              <div className="step-content">
                <h3>Upload Documents</h3>
                <p>Upload your PDF or Word documents containing study materials. Our platform supports multiple file formats and sizes.</p>
              </div>
            </div>

            <div className="step">
              <div className="step-number">02</div>
              <div className="step-content">
                <h3>AI Processing</h3>
                <p>Advanced AI algorithms analyze your content, extract key concepts, and generate intelligent questions automatically.</p>
              </div>
            </div>

            <div className="step">
              <div className="step-number">03</div>
              <div className="step-content">
                <h3>Start Learning</h3>
                <p>Practice with generated questions, track your progress, and receive personalized recommendations for improvement.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2>Ready to transform your learning?</h2>
            <p>Join thousands of students who are already achieving their goals with Vayrex.</p>
            {!isAuthenticated && (
              <div className="cta-buttons">
                <Link to="/Signup" className="btn btn-primary btn-large">
                  Start Learning Today <FiArrowRight size={16} />
                </Link>
                <Link to="/Login" className="btn btn-outline btn-large">
                  Sign In
                </Link>
              </div>
            )}
            {isAuthenticated && (
              <div className="cta-buttons">
                <Link to="/learn" className="btn btn-primary btn-large">
                  Continue Learning <FiArrowRight size={16} />
                </Link>
                <Link to="/Upload" className="btn btn-outline btn-large">
                  Upload Content
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;