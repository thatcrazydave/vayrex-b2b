import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FiArrowRight, FiArrowLeft, FiCheck, FiX } from 'react-icons/fi';
import api from '../services/api.js';

function getPasswordChecks(password) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

function PasswordChecklist({ password }) {
  const checks = getPasswordChecks(password);
  if (!password) return null;

  const items = [
    { key: 'length', label: 'At least 8 characters' },
    { key: 'uppercase', label: 'One uppercase letter (A–Z)' },
    { key: 'lowercase', label: 'One lowercase letter (a–z)' },
    { key: 'number', label: 'One number (0–9)' },
    { key: 'special', label: 'One special character (!@#$%^&*)' },
  ];

  return (
    <div style={{
      marginTop: 10,
      padding: '12px 14px',
      background: '#f0fdf4',
      border: '1px solid #bbf7d0',
      borderRadius: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {items.map(({ key, label }) => {
        const met = checks[key];
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: met ? '#16a34a' : '#e5e7eb',
              transition: 'background 0.2s',
            }}>
              {met
                ? <FiCheck size={11} color="#fff" strokeWidth={3} />
                : <FiX size={11} color="#9ca3af" strokeWidth={3} />}
            </span>
            <span style={{
              fontSize: 13,
              color: met ? '#15803d' : '#6b7280',
              fontWeight: met ? 600 : 400,
              transition: 'color 0.2s',
            }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SCHOOL_TYPES = [
  { value: 'primary', label: 'Primary School' },
  { value: 'secondary', label: 'Secondary School' },
  { value: 'combined', label: 'Combined (Primary + Secondary)' },
  { value: 'tertiary', label: 'Tertiary / College' },
  { value: 'other', label: 'Other' },
];

const INITIAL = {
  orgName: '',
  contactName: '',
  contactEmail: '',
  contactPassword: '',
  confirmPassword: '',
  schoolType: 'secondary',
  estimatedEnrollment: '',
};

function OrgSignup() {
  const [form, setForm] = useState(INITIAL);
  const [slugPreview, setSlugPreview] = useState('');
  const [slugAvailable, setSlugAvailable] = useState(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // ── Slug preview ─────────────────────────────────────────────────────────
  const debounceRef = React.useRef(null);

  function handleOrgNameChange(e) {
    const val = e.target.value;
    setForm((f) => ({ ...f, orgName: val }));

    const preview = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
    setSlugPreview(preview || '');
    setSlugAvailable(null);

    clearTimeout(debounceRef.current);
    if (preview.length >= 3) {
      setSlugChecking(true);
      debounceRef.current = setTimeout(async () => {
        try {
          // baseURL in api.js already includes /api — do not add it here
          const res = await api.get(`/onboarding/org/check-slug?slug=${encodeURIComponent(preview)}`);
          setSlugAvailable(res.data.available);
        } catch {
          setSlugAvailable(null);
        } finally {
          setSlugChecking(false);
        }
      }, 500);
    } else {
      setSlugChecking(false);
    }
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.orgName.trim()) return toast.error('School name is required');
    if (!form.contactName.trim()) return toast.error('Your name is required');
    if (!form.contactEmail.trim()) return toast.error('Email address is required');

    const checks = getPasswordChecks(form.contactPassword);
    const allChecksMet = Object.values(checks).every(Boolean);
    if (!allChecksMet) {
      return toast.error('Password does not meet all requirements');
    }
    if (form.contactPassword !== form.confirmPassword) return toast.error('Passwords do not match');

    const enrollment = parseInt(form.estimatedEnrollment, 10);
    if (!enrollment || enrollment < 1 || enrollment > 10000) {
      return toast.error('Please enter a valid estimated student count (1–10,000)');
    }

    setLoading(true);
    try {
      // CSRF token is automatically injected by the api.js request interceptor for POST
      const res = await api.post('/onboarding/org/register', {
        orgName: form.orgName,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPassword: form.contactPassword,
        schoolType: form.schoolType,
        estimatedEnrollment: enrollment,
      });

      // Auto-login: store tokens so the setup wizard is authenticated
      if (res.data.accessToken) {
        sessionStorage.setItem('authToken', res.data.accessToken);
        sessionStorage.setItem('refreshToken', res.data.refreshToken);
        if (res.data.user) {
          sessionStorage.setItem('user', JSON.stringify(res.data.user));
        }
      }

      toast.success('School registered! Redirecting to setup wizard…');
      // Force a full page reload to re-initialize auth context with the new tokens
      window.location.href = `/org-setup?orgId=${res.data.orgId}`;
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.data?.message || 'Registration failed. Please try again.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const slugColor = slugChecking ? '#6b7280' : slugAvailable === true ? '#16a34a' : slugAvailable === false ? '#ef4444' : '#6b7280';
  const slugNote = slugChecking
    ? 'Checking…'
    : slugAvailable === true
    ? `✓ Available — your portal will be at ${slugPreview}.madebyovo.me`
    : slugAvailable === false
    ? '✗ This name is already taken — try a different one'
    : slugPreview.length >= 3
    ? `Portal will be at ${slugPreview}.madebyovo.me`
    : '';

  const inputStyle = {
    display: 'block',
    width: '100%',
    padding: '11px 14px',
    border: '1.5px solid #ddd',
    borderRadius: 8,
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    marginTop: 6,
  };
  const labelStyle = { fontSize: 14, fontWeight: 600, color: '#333', display: 'block' };

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <div style={{ background: 'white', borderRadius: 16, padding: 40, maxWidth: 520, width: '100%', boxShadow: '0 4px 24px rgba(22,163,74,0.10)', border: '1px solid #bbf7d0' }}>
        {/* Header */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: 13, textDecoration: 'none', marginBottom: 16 }}>
            <FiArrowLeft size={13} /> Back to home
          </Link>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0a0a0a', margin: '0 0 8px' }}>Register Your School</h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Get started free — no credit card required</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* School name */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              School Name *
              <input
                name="orgName"
                value={form.orgName}
                onChange={handleOrgNameChange}
                placeholder="e.g. Greenfield Secondary School"
                required
                style={inputStyle}
              />
            </label>
            {slugNote && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: slugColor }}>{slugNote}</p>
            )}
          </div>

          {/* Contact name */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Your Full Name *
              <input
                name="contactName"
                value={form.contactName}
                onChange={handleChange}
                placeholder="Principal / IT Admin name"
                required
                style={inputStyle}
              />
            </label>
          </div>

          {/* Contact email */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Work Email *
              <input
                type="email"
                name="contactEmail"
                value={form.contactEmail}
                onChange={handleChange}
                placeholder="admin@yourschool.edu.ng"
                required
                style={inputStyle}
              />
            </label>
          </div>

          {/* School type */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              School Type *
              <select name="schoolType" value={form.schoolType} onChange={handleChange} style={{ ...inputStyle, background: 'white' }}>
                {SCHOOL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Estimated enrollment */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Estimated Student Count *
              <input
                type="number"
                name="estimatedEnrollment"
                value={form.estimatedEnrollment}
                onChange={handleChange}
                placeholder="e.g. 350"
                min={1}
                max={10000}
                required
                style={inputStyle}
              />
            </label>
            <p style={{ margin: '5px 0 0', fontSize: 12, color: '#999' }}>Determines your seat allocation and plan.</p>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Password *
              <input
                type="password"
                name="contactPassword"
                value={form.contactPassword}
                onChange={handleChange}
                placeholder="Min. 8 characters"
                required
                style={inputStyle}
              />
            </label>
            <PasswordChecklist password={form.contactPassword} />
          </div>

          {/* Confirm password */}
          <div style={{ marginBottom: 28 }}>
            <label style={labelStyle}>
              Confirm Password *
              <input
                type="password"
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="Re-enter password"
                required
                style={inputStyle}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px 0',
              background: loading ? '#86efac' : '#16a34a',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 16,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'background 0.2s',
            }}
          >
            {loading ? 'Registering…' : <><span>Register School</span><FiArrowRight size={16} /></>}
          </button>

          <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#6b7280' }}>
            Already have an account?{' '}
            <Link to="/Login" style={{ color: '#16a34a', textDecoration: 'none', fontWeight: 600 }}>Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default OrgSignup;
