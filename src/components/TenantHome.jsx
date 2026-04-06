/**
 * TenantHome.jsx
 *
 * The school-branded portal homepage — served at "/" on any tenant subdomain
 * (e.g. greenfield.madebyovo.me).
 *
 * Uses the same rich layout as SchoolsLanding.jsx but all Vayrex-specific
 * copy/colours are replaced by the school's own branding pulled from
 * TenantContext. CTAs point to /Login instead of /org-signup.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import {
  FiCheckCircle, FiArrowRight, FiUsers, FiBookOpen,
  FiBarChart2, FiShield, FiLogIn,
} from 'react-icons/fi';
import { useTenant } from '../contexts/TenantContext';

const PORTAL_FEATURES = [
  {
    icon: <FiUsers size={24} />,
    title: 'Student & Staff Accounts',
    desc: 'Every teacher, student and guardian has a dedicated account. Role-based access keeps the right content in front of the right people.',
  },
  {
    icon: <FiBookOpen size={24} />,
    title: 'Academic Calendar',
    desc: 'Track terms, subjects and class timetables in one place. Academic history is archived and available on demand.',
  },
  {
    icon: <FiBarChart2 size={24} />,
    title: 'Grades & Report Cards',
    desc: 'Digital grade books with automatic CA/Exam computation. Report cards generated as PDFs and delivered to guardians.',
  },
  {
    icon: <FiShield size={24} />,
    title: 'Private & Secure',
    desc: 'Your school's data is completely isolated. No other school can ever see your students, grades or records.',
  },
];

const PORTAL_BENEFITS = [
  'Access your classes and assignments',
  'View grades and report cards',
  'Guardian portal for parents',
  'AI-powered study materials',
  'Offline exam support',
  'Attendance records',
  'School announcements',
];

function TenantHome() {
  const { tenant } = useTenant();

  if (!tenant) return null;

  const branding     = tenant.branding ?? {};
  const displayName  = branding.displayName  || tenant.name;
  const tagline      = branding.tagline      || `Welcome to the ${displayName} learning portal`;
  const heroText     = branding.loginHeroText || `Manage classes, grades, attendance, and assessments — all in one place, powered by AI.`;
  const logoUrl      = branding.logoUrl;
  const primary      = branding.primaryColor || '#2563eb';
  const accent       = branding.accentColor  || '#10b981';
  const hideVayrex   = branding.hideVayrexBranding;

  // Derive a slightly darker shade for gradients by overlaying 10% black
  const heroBg = `linear-gradient(135deg, ${primary} 0%, ${primary}cc 100%)`;

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0a0a0a' }}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{ background: heroBg, color: 'white', padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>

          {/* School logo or name badge */}
          {logoUrl ? (
            <div style={{ marginBottom: 28 }}>
              <img
                src={logoUrl}
                alt={`${displayName} logo`}
                style={{ maxHeight: 80, maxWidth: 220, objectFit: 'contain' }}
              />
            </div>
          ) : (
            <span style={{
              display: 'inline-block',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 20,
              padding: '4px 18px',
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 24,
              letterSpacing: '0.03em',
            }}>
              {displayName}
            </span>
          )}

          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', fontWeight: 800, lineHeight: 1.2, margin: '0 0 20px' }}>
            {tagline}
          </h1>

          <p style={{ fontSize: 18, opacity: 0.88, lineHeight: 1.7, margin: '0 0 44px' }}>
            {heroText}
          </p>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/Login"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'white', color: primary,
                padding: '14px 32px', borderRadius: 8,
                textDecoration: 'none', fontWeight: 700, fontSize: 16,
              }}
            >
              <FiLogIn size={16} />
              Sign in to your portal
            </Link>
            <Link
              to="/forgot-password"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(255,255,255,0.12)', color: 'white',
                padding: '14px 32px', borderRadius: 8,
                textDecoration: 'none', fontWeight: 600, fontSize: 16,
                border: '1px solid rgba(255,255,255,0.25)',
              }}
            >
              Forgot password
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', background: '#f9f9f9' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
            Everything in Your School Portal
          </h2>
          <p style={{ textAlign: 'center', color: '#666', marginBottom: 56, fontSize: 16 }}>
            Built for students, teachers, and guardians at {displayName}.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32 }}>
            {PORTAL_FEATURES.map((f) => (
              <div key={f.title} style={{ background: 'white', borderRadius: 12, padding: 28, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <div style={{ color: primary, marginBottom: 16 }}>{f.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{f.title}</h3>
                <p style={{ color: '#666', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What you can do ──────────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 48 }}>
            What's available on your portal
          </h2>
          <div style={{ textAlign: 'left', display: 'inline-block' }}>
            {PORTAL_BENEFITS.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 15 }}>
                <FiCheckCircle size={18} color={accent} style={{ flexShrink: 0 }} />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 56 }}>
            <Link
              to="/Login"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: primary, color: 'white',
                padding: '16px 40px', borderRadius: 8,
                textDecoration: 'none', fontWeight: 700, fontSize: 17,
                boxShadow: `0 4px 14px ${primary}40`,
              }}
            >
              <FiLogIn size={17} />
              Sign in to {displayName} <FiArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Powered by Vayrex ────────────────────────────────────────────── */}
      {!hideVayrex && (
        <div style={{ textAlign: 'center', padding: '20px 24px', borderTop: '1px solid #e5e7eb' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
            Powered by{' '}
            <a
              href="https://madebyovo.me"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: accent, fontWeight: 600, textDecoration: 'none' }}
            >
              Vayrex
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

export default TenantHome;
