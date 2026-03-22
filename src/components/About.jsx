import React from 'react';
import { FiCpu, FiFileText, FiTrendingUp, FiBook, FiCheck } from 'react-icons/fi';
import '../styles/about.css';

const About = () => {
  return (
    <div className="about-page">
      <div className="about-hero">
        <div className="hero-content">
          <h1>About Vayrex</h1>
          <p className="hero-subtitle">
            Your intelligent learning companion powered by advanced AI technology
          </p>
        </div>
      </div>

      <div className="about-content">
        <section className="about-section">
          <div className="section-content">
            <h2>Our Mission</h2>
            <p>
              Vayrex is designed to revolutionize the way students learn and interact with educational content. 
              We combine cutting-edge AI technology with intuitive design to create a comprehensive learning 
              platform that adapts to your needs and helps you achieve your academic goals.
            </p>
          </div>
        </section>

        <section className="features-section">
          <div className="section-content">
            <h2>Key Features</h2>
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon">
                  <FiCpu size={32} />
                </div>
                <h3>AI-Powered Learning</h3>
                <p>Advanced AI assistant that can solve math problems, write code, and provide detailed explanations across all academic subjects.</p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  <FiFileText size={32} />
                </div>
                <h3>Smart Document Processing</h3>
                <p>Upload PDFs, documents, and images. Our AI extracts questions and creates interactive quizzes automatically.</p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  <FiTrendingUp size={32} />
                </div>
                <h3>Progress Tracking</h3>
                <p>Monitor your learning progress with detailed analytics, performance metrics, and personalized study recommendations.</p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  <FiBook size={32} />
                </div>
                <h3>Adaptive Learning</h3>
                <p>Personalized learning paths that adjust to your pace and learning style for optimal knowledge retention.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="team-section">
          <div className="section-content">
            <h2>Why Choose Vayrex?</h2>
            <div className="benefits-list">
              <div className="benefit-item">
                <FiCheck size={20} />
                <span>Comprehensive AI assistance for all academic subjects</span>
              </div>
              <div className="benefit-item">
                <FiCheck size={20} />
                <span>Intelligent document processing and question extraction</span>
              </div>
              <div className="benefit-item">
                <FiCheck size={20} />
                <span>Real-time progress tracking and analytics</span>
              </div>
              <div className="benefit-item">
                <FiCheck size={20} />
                <span>Professional, clean interface designed for productivity</span>
              </div>
              <div className="benefit-item">
                <FiCheck size={20} />
                <span>Secure authentication and data protection</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default About;
