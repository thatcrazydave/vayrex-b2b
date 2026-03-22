import React, { useState } from 'react';
import API from '../services/api.js';
import '../styles/contact.css';
import { FiMail, FiClock, FiMapPin, FiUser, FiMessageSquare, FiSend, FiCheckCircle, FiCopy, FiX, FiLoader } from 'react-icons/fi';

const Contact = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);
  const [ticketId, setTicketId] = useState(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const response = await API.post('/contact', formData);
      setSubmitStatus('success');
      setTicketId(response.data?.data?.ticketId || null);
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch (error) {
      console.error('Contact form error:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="contact-page">
      <div className="contact-hero">
        <div className="hero-content">
          <h1>Contact Us</h1>
          <p className="hero-subtitle">
            Have questions or feedback? We'd love to hear from you.
          </p>
        </div>
      </div>

      <div className="contact-content">
        <div className="contact-container">
          <div className="contact-info">
            <h2>Get in Touch</h2>
            <p>
              Whether you have questions about our platform, need technical support,
              or want to share feedback, we're here to help.
            </p>

            <div className="contact-methods">
              <div className="contact-method">
                <div className="method-icon">
                  <FiMail size={24} />
                </div>
                <div className="method-content">
                  <h3>Email Support</h3>
                  <p>support@vayrex.com</p>
                </div>
              </div>

              <div className="contact-method">
                <div className="method-icon">
                  <FiClock size={24} />
                </div>
                <div className="method-content">
                  <h3>Response Time</h3>
                  <p>We typically respond within 24 hours</p>
                </div>
              </div>

              <div className="contact-method">
                <div className="method-icon">
                  <FiMapPin size={24} />
                </div>
                <div className="method-content">
                  <h3>Global Support</h3>
                  <p>Available worldwide, 24/7</p>
                </div>
              </div>
            </div>
          </div>

          <div className="contact-form-container">
            <form className="contact-form" onSubmit={handleSubmit} noValidate autoComplete="off">
              <h2>Send us a Message</h2>

              <div className="form-group">
                <label htmlFor="name">Full Name</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="Enter your full name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="Enter your email address"
                />
              </div>

              <div className="form-group">
                <label htmlFor="subject">Subject</label>
                <select
                  id="subject"
                  name="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select a subject</option>
                  <option value="general">General Inquiry</option>
                  <option value="technical">Technical Support</option>
                  <option value="feature">Feature Request</option>
                  <option value="bug">Bug Report</option>
                  <option value="feedback">Feedback</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="message">Message</label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  required
                  rows="6"
                  placeholder="Tell us how we can help you..."
                />
              </div>

              {submitStatus === 'success' && (
                <div className="success-message">
                  <FiCheckCircle size={20} />
                  <div>
                    <strong>Thank you! Your message has been sent successfully.</strong>
                    {ticketId && (
                      <p style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
                        Your ticket ID: <strong>{ticketId}</strong> — save this for follow-ups.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {submitStatus === 'error' && (
                <div className="error-message">
                  <FiCheckCircle size={20} />
                  Sorry, there was an error sending your message. Please try again.
                </div>
              )}

              <button
                type="submit"
                className="submit-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <FiLoader size={16} />
                    Sending...
                  </>
                ) : (
                  <>
                    <FiSend size={16} />
                    Send Message
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contact;
