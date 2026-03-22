import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { getPlans, initiateUpgrade, cancelSubscription } from '../services/api.js';
import { showToast } from '../utils/toast.js';
import '../styles/pricing.css';

const PLAN_ORDER = ['free', 'starter', 'pro'];

// Currency symbols and locale mapping
const CURRENCY_MAP = {
  USD: { symbol: '$', locale: 'en-US', name: 'US Dollar' },
  NGN: { symbol: '₦', locale: 'en-NG', name: 'Nigerian Naira' },
  GBP: { symbol: '£', locale: 'en-GB', name: 'British Pound' },
  EUR: { symbol: '€', locale: 'de-DE', name: 'Euro' },
  CAD: { symbol: 'C$', locale: 'en-CA', name: 'Canadian Dollar' },
  INR: { symbol: '₹', locale: 'en-IN', name: 'Indian Rupee' },
  GHS: { symbol: 'GH₵', locale: 'en-GH', name: 'Ghanaian Cedi' },
  ZAR: { symbol: 'R', locale: 'en-ZA', name: 'South African Rand' },
  KES: { symbol: 'KSh', locale: 'en-KE', name: 'Kenyan Shilling' }
};

// Detect user's likely currency from timezone/locale
const detectCurrency = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const lang = navigator.language || '';
    if (tz.includes('Lagos') || lang.includes('ng')) return 'NGN';
    if (tz.includes('London') || lang.includes('en-GB')) return 'GBP';
    if (tz.includes('Europe/') && !tz.includes('London')) return 'EUR';
    if (tz.includes('Kolkata') || lang.includes('in')) return 'INR';
    if (tz.includes('Accra')) return 'GHS';
    if (tz.includes('Johannesburg')) return 'ZAR';
    if (tz.includes('Nairobi')) return 'KES';
    if (tz.includes('Toronto') || lang.includes('en-CA')) return 'CAD';
    return 'USD';
  } catch {
    return 'USD';
  }
};

const Pricing = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [exchangeRates, setExchangeRates] = useState({});
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [currency] = useState(detectCurrency);
  const [upgrading, setUpgrading] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);

  const currentTier = user?.subscriptionTier || 'free';

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const res = await getPlans();
      if (res.success) {
        setPlans(res.data);
        if (res.exchangeRates) setExchangeRates(res.exchangeRates);
      }
    } catch (err) {
      console.error('Failed to load plans:', err);
      showToast.error('Failed to load plans. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Convert USD cents to local currency amount
  const convertPrice = (usdCents) => {
    if (usdCents === 0) return 0;
    if (currency === 'USD') return usdCents / 100;
    const rate = exchangeRates[currency] || 1;
    return (usdCents / 100) * rate;
  };

  // Format price in selected currency
  const formatPrice = (usdCents) => {
    if (usdCents === 0) return 'Free';
    const amount = convertPrice(usdCents);
    const currInfo = CURRENCY_MAP[currency] || CURRENCY_MAP.USD;
    const isLargeCurrency = ['NGN', 'KES', 'INR', 'GHS', 'ZAR'].includes(currency);
    const formatted = isLargeCurrency
      ? Math.round(amount).toLocaleString(currInfo.locale)
      : amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${currInfo.symbol}${formatted}`;
  };

  const handleUpgrade = async (tier) => {
    if (!user) {
      showToast.info('Please log in to upgrade your plan.');
      navigate('/Login');
      return;
    }
    if (tier === currentTier) return;

    try {
      setUpgrading(tier);
      const res = await initiateUpgrade(tier, billingCycle);
      if (res.success && (res.data?.authorization_url || res.data?.authorizationUrl)) {
        window.location.href = res.data.authorization_url || res.data.authorizationUrl;
      } else if (res.success) {
        showToast.success('Plan updated successfully!');
        if (updateUser) updateUser({ subscriptionTier: tier });
      } else {
        showToast.error(res.error?.message || 'Failed to initiate upgrade');
      }
    } catch (err) {
      console.error('Upgrade failed:', err);
      const errMsg =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        'Failed to process upgrade.';
      showToast.error(errMsg);
    } finally {
      setUpgrading(null);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel? You\'ll be downgraded to Free.')) return;
    try {
      setCancelling(true);
      const res = await cancelSubscription();
      if (res.success) {
        showToast.success('Subscription cancelled.');
        if (updateUser) updateUser({ subscriptionTier: 'free' });
      } else {
        showToast.error(res.error?.message || 'Failed to cancel');
      }
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to cancel.');
    } finally {
      setCancelling(false);
    }
  };

  const getTierIndex = (tier) => PLAN_ORDER.indexOf(tier);

  const getButtonProps = (tier) => {
    const tierIdx = getTierIndex(tier);
    const currentIdx = getTierIndex(currentTier);
    if (tier === currentTier) {
      return { label: 'Current Plan', className: 'plan-btn outline', disabled: true };
    }
    if (tierIdx > currentIdx) {
      return { label: upgrading === tier ? 'Processing...' : 'Upgrade', className: 'plan-btn primary', disabled: !!upgrading };
    }
    return { label: 'Downgrade', className: 'plan-btn outline', disabled: true };
  };

  const faqs = [
    {
      q: 'Can I change my plan at any time?',
      a: 'Yes! You can upgrade your plan and it takes effect immediately after payment.'
    },
    {
      q: 'How does billing work?',
      a: 'You\'re charged at the start of each billing cycle. Yearly plans save ~20%.'
    },
    {
      q: 'What payment methods do you accept?',
      a: 'We accept all major debit/credit cards, bank transfers, and mobile money through Paystack. Prices are shown in your local currency for convenience.'
    },
    {
      q: 'When do my limits reset?',
      a: 'Free tier upload limits reset daily at midnight UTC. Starter and Pro monthly limits reset on the 1st of each month.'
    },
    {
      q: 'What happens if I downgrade?',
      a: 'Your data is always preserved. You\'ll lose access to premium features but keep your existing questions and results.'
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
          <h1>Plans that works for you</h1>
          <p>Choose the plan that fits your learning needs. Upgrade or downgrade anytime.</p>
        </div>
      </div>

      <div className="plans-container">
        {/* Currency auto-detected */}
        {/* <div className="currency-info" style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}> */}
        {/* <span>Prices shown in {CURRENCY_MAP[currency]?.name || 'US Dollar'} ({CURRENCY_MAP[currency]?.symbol || '$'})</span> */}
        {/* </div> */}

        {/* Current Plan */}
        {/* {user && (
          <div className="current-plan-banner" style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <span className="plan-badge" style={{ background: 'var(--background-light)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', marginRight: '8px', textTransform: 'uppercase' }}>{currentTier}</span>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>You are on the <strong>{currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}</strong> plan</span>
          </div>
        )} */}

        {/* Billing Toggle */}
        <div className="billing-toggle">
          <span className={`billing-label ${billingCycle === 'monthly' ? 'active' : ''}`}>Monthly</span>
          <button
            className={`toggle-switch ${billingCycle === 'yearly' ? 'active' : ''}`}
            onClick={() => setBillingCycle(prev => prev === 'monthly' ? 'yearly' : 'monthly')}
            aria-label="Toggle billing cycle"
          >
            <div className="toggle-knob" />
          </button>
          <span className={`billing-label ${billingCycle === 'yearly' ? 'active' : ''}`}>Yearly</span>
          <span className="save-badge">Save ~20%</span>
        </div>

        {/* Plans Grid - 3 columns */}
        <div className="plans-grid">
          {PLAN_ORDER.map((tierKey) => {
            const plan = plans.find(p => p.tier === tierKey);
            if (!plan) return null;

            const priceUSD = billingCycle === 'monthly'
              ? plan.pricing?.monthlyUSD || 0
              : plan.pricing?.yearlyUSD || 0;
            const monthlyEquivUSD = billingCycle === 'yearly' ? Math.round(priceUSD / 12) : priceUSD;
            const isPopular = tierKey === 'starter';
            const isCurrent = tierKey === currentTier;
            const btnProps = getButtonProps(tierKey);

            return (
              <div
                key={tierKey}
                className={`plan-card ${isPopular ? 'popular' : ''} ${isCurrent ? 'current' : ''}`}
              >
                {isPopular && <span className="popular-badge">Most Popular</span>}
                {isCurrent && <span className="current-badge">Your Plan</span>}

                <h3 className="plan-name">{plan.name || tierKey.charAt(0).toUpperCase() + tierKey.slice(1)}</h3>
                <p className="plan-description">{plan.description || ''}</p>

                <div className="plan-price">
                  {monthlyEquivUSD === 0 ? (
                    <span className="amount">Free</span>
                  ) : (
                    <>
                      <span className="amount">{formatPrice(monthlyEquivUSD)}</span>
                      <span className="period">/month</span>
                    </>
                  )}
                </div>

                {billingCycle === 'yearly' && priceUSD > 0 && (
                  <p className="yearly-note">Billed {formatPrice(priceUSD)}/year</p>
                )}

                {/* Reset info */}
                {/* <div className="reset-info">
                  {tierKey === 'free'
                    ? '↻ Limits reset daily at midnight'
                    : '↻ Limits reset monthly on the 1st'}
                </div> */}

                <ul className="plan-features">
                  {(plan.features || []).map((feature, i) => (
                    <li key={i}>
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="plan-action">
                  <button
                    className={btnProps.className}
                    disabled={btnProps.disabled}
                    onClick={() => handleUpgrade(tierKey)}
                  >
                    {btnProps.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Cancel Subscription */}
        {user && currentTier !== 'free' && (
          <div className="cancel-section" style={{ textAlign: 'center', marginTop: '2rem', padding: '2rem', background: 'var(--background-light)', borderRadius: 'var(--radius-lg)' }}>
            <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Want to cancel? You'll keep access until the end of your billing period.</p>
            <button onClick={handleCancel} disabled={cancelling} className="plan-btn outline" style={{ maxWidth: '200px', margin: '0 auto' }}>
              {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
            </button>
          </div>
        )}
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
