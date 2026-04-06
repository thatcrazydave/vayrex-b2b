import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { getPlans } from '../services/api.js';
import { showToast } from '../utils/toast.js';
import '../styles/pricing.css';
import { FiCheckCircle, FiArrowRight, FiMail } from 'react-icons/fi';

// School plans shown in order (per master plan Section 2 + PricingConfig school tiers)
const SCHOOL_PLAN_ORDER = ['school_starter', 'school_pro', 'enterprise'];

const Pricing = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const res = await getPlans();
      if (res.success) {
        // Filter to school tiers only
        setPlans((res.data || []).filter(p => SCHOOL_PLAN_ORDER.includes(p.tier)));
      }
    } catch (err) {
      console.error('Failed to load plans:', err);
      showToast.error('Failed to load plans. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatNGN = (amount) => {
    if (!amount || amount === 0) return 'Custom';
    return `₦${Number(amount).toLocaleString('en-NG')}`;
  };

  const faqs = [
    {
      q: 'How is pricing structured?',
      a: 'Vayrex B2B is billed per term (3 terms = one academic year). School Starter covers up to 200 students; School Pro covers up to 1,000. Enterprise is invoiced annually on a custom quote.'
    },
    {
      q: 'What happens at the end of a term?',
      a: 'Your data is never deleted. Closed terms are archived to secure storage and remain accessible to authorised staff at any time.'
    },
    {
      q: 'Can we upgrade mid-term?',
      a: 'Yes. Contact us and we\'ll pro-rate the difference. Downgrades take effect at the next renewal.'
    },
    {
      q: 'Is there a setup fee?',
      a: 'No. Onboarding is free. Our setup wizard takes most schools live in under 30 minutes.'
    },
    {
      q: 'What payment methods do you accept?',
      a: 'Bank transfer, Paystack (card/USSD), and invoice. Enterprise customers can arrange annual invoicing.'
    }
  ];

  if (loading) {
    return (
      <div className="pricing-loading">
        <div className="loading-spinner"></div>
        <p>Loading plans...</p>
      </div>
    );
  }

  return (
    <div className="pricing-page">
      <div className="pricing-hero">
        <div className="pricing-container">
          <h1>Simple, school-friendly pricing</h1>
          <p>Billed per term. No individual subscriptions. One plan covers your whole school.</p>
        </div>
      </div>

      <div className="plans-container">
        <div className="plans-grid">
          {SCHOOL_PLAN_ORDER.map((tierKey) => {
            const plan = plans.find(p => p.tier === tierKey);
            const isPopular = tierKey === 'school_pro';
            const isEnterprise = tierKey === 'enterprise';
            const termPrice = plan?.pricing?.termPriceNGN ?? (tierKey === 'school_starter' ? 150000 : tierKey === 'school_pro' ? 400000 : 0);
            const seats = plan?.seats ?? (tierKey === 'school_starter' ? 200 : tierKey === 'school_pro' ? 1000 : null);
            const features = plan?.features || [];
            const name = plan?.name || (tierKey === 'school_starter' ? 'School Starter' : tierKey === 'school_pro' ? 'School Pro' : 'Enterprise');
            const description = plan?.description || '';

            return (
              <div
                key={tierKey}
                className={`plan-card ${isPopular ? 'popular' : ''}`}
              >
                {isPopular && <span className="popular-badge">Most Popular</span>}

                <h3 className="plan-name">{name}</h3>
                <p className="plan-description">{description}</p>

                <div className="plan-price">
                  {isEnterprise ? (
                    <span className="amount">Custom</span>
                  ) : (
                    <>
                      <span className="amount">{formatNGN(termPrice)}</span>
                      <span className="period">/term</span>
                    </>
                  )}
                </div>

                {seats && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 1rem' }}>
                    Up to {seats === -1 ? 'unlimited' : seats.toLocaleString()} students
                  </p>
                )}

                <ul className="plan-features">
                  {features.map((f, i) => (
                    <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                      <FiCheckCircle size={14} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--primary)' }} />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="plan-action">
                  {isEnterprise ? (
                    <Link to="/contact" className="plan-btn outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                      <FiMail size={14} /> Contact Sales
                    </Link>
                  ) : (
                    <Link to="/org-signup" className="plan-btn primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                      Register Your School <FiArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FAQ */}
      <div className="pricing-faq faq-section">
        <h2>Frequently Asked Questions</h2>
        {faqs.map((faq, i) => (
          <div key={i} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
            <button
              className="faq-question"
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
            >
              {faq.q}
              <span className="faq-icon">▾</span>
            </button>
            {openFaq === i && (
              <div className="faq-answer">
                <p>{faq.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Pricing;
