/**
 * TenantHome.jsx
 *
 * School-branded portal homepage — served at "/" on any tenant subdomain.
 * Redesigned to look like a professional university management portal.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiUsers, FiBookOpen, FiBarChart2, FiShield,
  FiLogIn, FiMenu, FiX, FiChevronRight,
  FiCalendar, FiAward, FiBell, FiFileText,
} from 'react-icons/fi';
import { useTenant } from '../contexts/TenantContext';

// ── Portal user categories ──────────────────────────────────────────────────
const PORTAL_ROLES = [
  {
    key: 'students',
    label: 'Students',
    icon: <FiBookOpen size={28} />,
    desc: 'Access your classes, grades, timetable and assignments.',
  },
  {
    key: 'staff',
    label: 'Staff',
    icon: <FiUsers size={28} />,
    desc: 'Manage your classes, submit grades and track attendance.',
  },
  {
    key: 'guardians',
    label: 'Guardians',
    icon: <FiShield size={28} />,
    desc: "Monitor your ward's academic progress and fee status.",
  },
  {
    key: 'alumni',
    label: 'Alumni',
    icon: <FiAward size={28} />,
    desc: 'Access your transcripts and stay connected with the school.',
  },
];

const PORTAL_FEATURES = [
  { icon: <FiBarChart2 size={20} />, title: 'Grades & Reports', desc: 'Digital grade books, automatic CA/Exam computation, and PDF report cards.' },
  { icon: <FiCalendar size={20} />, title: 'Timetable & Calendar', desc: 'Academic calendar, class schedules and term dates in one place.' },
  { icon: <FiBell size={20} />, title: 'Announcements', desc: 'School-wide notices and class-level updates delivered instantly.' },
  { icon: <FiFileText size={20} />, title: 'Assignments', desc: 'Submit, review and track coursework from anywhere, on any device.' },
];

// ── Helper: school initials badge ───────────────────────────────────────────
function InitialsBadge({ name, size = 40, bg = 'rgba(255,255,255,0.2)', color = '#fff', fontSize = 16 }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: bg, color, fontSize, fontWeight: 800,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, letterSpacing: '0.02em',
    }}>
      {initials}
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
function TenantHome() {
  const { tenant, loading } = useTenant();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (loading) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`@keyframes th-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ textAlign: 'center', color: '#666' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'th-spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ margin: 0, fontSize: 14 }}>Loading portal…</p>
      </div>
    </div>
  );

  if (!tenant) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', color: '#666', maxWidth: 400 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 12 }}>Portal not found</h2>
        <p style={{ margin: 0, fontSize: 15 }}>This school portal could not be loaded. Please check the URL or contact your administrator.</p>
      </div>
    </div>
  );

  const branding    = tenant.branding ?? {};
  const displayName = branding.displayName || tenant.name;
  const tagline     = branding.tagline || `${displayName} Portal`;
  const heroText    = branding.loginHeroText || 'The official online portal for students, staff, guardians and alumni.';
  const logoUrl     = branding.logoUrl;
  const primary     = branding.primaryColor || '#1e3a5f';
  const accent      = branding.accentColor  || '#f59e0b';
  const hideVayrex  = branding.hideVayrexBranding;

  // Slightly lighter shade for nav hover states
  const navHover = `${primary}dd`;

  const NAV_LINKS = ['Home', 'Students', 'Staff', 'Guardians', 'Alumni'];

  return (
    <div style={{ fontFamily: "'Inter', Arial, sans-serif", color: '#0a0a0a', overflowX: 'hidden' }}>

      {/* ── Top bar (contact/info strip) ──────────────────────────────────── */}
      <div style={{ background: accent, padding: '6px 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 24, fontSize: 12, fontWeight: 600, color: '#111' }}>
        <span>Portal Access: 24/7</span>
        <span style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.2)' }} />
        <span>For support, contact your school admin</span>
      </div>

      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <nav style={{ background: primary, padding: '0 24px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 12px rgba(0,0,0,0.18)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', height: 68, gap: 20 }}>

          {/* Logo + Name */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
            {logoUrl ? (
              <img src={logoUrl} alt={displayName} style={{ height: 44, width: 44, objectFit: 'contain', borderRadius: 6 }} />
            ) : (
              <InitialsBadge name={displayName} size={44} bg={accent} color="#111" fontSize={17} />
            )}
            <span style={{ color: 'white', fontWeight: 800, fontSize: 17, lineHeight: 1.25, maxWidth: 200, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              {displayName}
            </span>
          </Link>

          {/* Nav links — desktop */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 4 }} className="nav-desktop">
            {NAV_LINKS.map((link, i) => (
              <a
                key={link}
                href="#portal-access"
                style={{
                  color: i === 0 ? accent : 'rgba(255,255,255,0.82)',
                  padding: '8px 16px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: i === 0 ? 700 : 500,
                  borderBottom: i === 0 ? `2px solid ${accent}` : '2px solid transparent',
                  transition: 'color 0.15s',
                }}
              >
                {link}
              </a>
            ))}
          </div>

          {/* Login CTA */}
          <Link
            to="/Login"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: accent, color: '#111',
              padding: '10px 20px', borderRadius: 8,
              textDecoration: 'none', fontWeight: 700, fontSize: 14,
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            <FiLogIn size={15} /> Portal Login
          </Link>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: 8, display: 'none' }}
            className="nav-mobile-btn"
            aria-label="Toggle menu"
          >
            {mobileNavOpen ? <FiX size={24} /> : <FiMenu size={24} />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileNavOpen && (
          <div style={{ background: primary, borderTop: '1px solid rgba(255,255,255,0.1)', padding: '12px 0' }} className="nav-mobile-menu">
            {NAV_LINKS.map((link) => (
              <a key={link} href="#portal-access" style={{ display: 'block', color: 'rgba(255,255,255,0.85)', padding: '10px 24px', textDecoration: 'none', fontSize: 15 }} onClick={() => setMobileNavOpen(false)}>
                {link}
              </a>
            ))}
            <div style={{ padding: '12px 24px' }}>
              <Link to="/Login" style={{ display: 'block', background: accent, color: '#111', padding: '11px 20px', borderRadius: 8, textDecoration: 'none', fontWeight: 700, textAlign: 'center' }}>
                Portal Login
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{
        background: `linear-gradient(150deg, ${primary} 0%, ${primary}e8 55%, ${accent}55 100%)`,
        color: 'white',
        padding: 'clamp(60px, 10vw, 100px) 24px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: `${accent}18`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 240, height: 240, borderRadius: '50%', background: `${accent}12`, pointerEvents: 'none' }} />

        <div style={{ maxWidth: 800, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          {logoUrl && (
            <img src={logoUrl} alt={displayName} style={{ height: 80, maxWidth: 200, objectFit: 'contain', marginBottom: 28, filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.25))' }} />
          )}
          <div style={{ display: 'inline-block', background: `${accent}30`, border: `1px solid ${accent}60`, borderRadius: 20, padding: '4px 18px', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 20, color: accent }}>
            Official School Portal
          </div>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.4rem)', fontWeight: 900, lineHeight: 1.15, margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
            {displayName}
          </h1>
          <p style={{ fontSize: 'clamp(15px, 2.5vw, 19px)', opacity: 0.88, lineHeight: 1.7, margin: '0 0 18px', fontStyle: 'italic', fontWeight: 500 }}>
            {tagline}
          </p>
          <p style={{ fontSize: 15, opacity: 0.75, lineHeight: 1.7, margin: '0 0 44px', maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>
            {heroText}
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/Login"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: accent, color: '#111',
                padding: '14px 32px', borderRadius: 8,
                textDecoration: 'none', fontWeight: 800, fontSize: 16,
                boxShadow: `0 4px 20px rgba(0,0,0,0.25)`,
              }}
            >
              <FiLogIn size={17} /> Access Portal
            </Link>
            <a
              href="#features"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(255,255,255,0.12)', color: 'white',
                padding: '14px 32px', borderRadius: 8,
                textDecoration: 'none', fontWeight: 600, fontSize: 16,
                border: '1px solid rgba(255,255,255,0.25)',
              }}
            >
              Learn More <FiChevronRight size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Quick Access tiles ────────────────────────────────────────────── */}
      <section id="portal-access" style={{ padding: 'clamp(48px, 7vw, 80px) 24px', background: '#f8f9fa' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 800, margin: '0 0 10px', color: '#111' }}>
              Who are you?
            </h2>
            <p style={{ color: '#666', fontSize: 15, margin: 0 }}>Select your role to access the appropriate portal.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            {PORTAL_ROLES.map((role) => (
              <Link
                key={role.key}
                to="/Login"
                style={{ textDecoration: 'none' }}
              >
                <div style={{
                  background: 'white',
                  borderRadius: 14,
                  padding: '32px 24px',
                  textAlign: 'center',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
                  border: '2px solid transparent',
                  transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
                  cursor: 'pointer',
                }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = primary;
                    e.currentTarget.style.boxShadow = `0 6px 24px rgba(0,0,0,0.12)`;
                    e.currentTarget.style.transform = 'translateY(-3px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.07)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ color: primary, marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
                    {role.icon}
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>{role.label}</h3>
                  <p style={{ color: '#666', fontSize: 13, lineHeight: 1.6, margin: '0 0 20px' }}>{role.desc}</p>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: primary, color: 'white',
                    padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700,
                  }}>
                    Login <FiChevronRight size={13} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: 'clamp(48px, 7vw, 80px) 24px', background: 'white' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 800, margin: '0 0 10px', color: '#111' }}>
              Portal Features
            </h2>
            <p style={{ color: '#666', fontSize: 15, margin: 0 }}>
              Everything your school needs, in one secure platform.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 24 }}>
            {PORTAL_FEATURES.map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 24, background: '#f8f9fa', borderRadius: 12, borderLeft: `4px solid ${primary}` }}>
                <div style={{ color: primary, flexShrink: 0, marginTop: 2 }}>{f.icon}</div>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px', color: '#111' }}>{f.title}</h3>
                  <p style={{ fontSize: 13, color: '#666', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ───────────────────────────────────────────────────── */}
      <section style={{ background: primary, padding: 'clamp(40px, 6vw, 64px) 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(20px, 4vw, 28px)', fontWeight: 800, color: 'white', margin: '0 0 12px' }}>
            Ready to get started?
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, margin: '0 0 32px', lineHeight: 1.7 }}>
            Sign in to your {displayName} portal to access your dashboard.
          </p>
          <Link
            to="/Login"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: accent, color: '#111',
              padding: '15px 40px', borderRadius: 8,
              textDecoration: 'none', fontWeight: 800, fontSize: 16,
            }}
          >
            <FiLogIn size={17} /> Sign In Now
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{ background: '#111', color: 'rgba(255,255,255,0.65)', padding: '28px 24px', textAlign: 'center', fontSize: 13 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{displayName}</span>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/Login" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Login</Link>
            <Link to="/forgot-password" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>Forgot Password</Link>
          </div>
          {!hideVayrex && (
            <span>
              Powered by{' '}
              <a href="https://madebyovo.me" target="_blank" rel="noopener noreferrer" style={{ color: accent, fontWeight: 600, textDecoration: 'none' }}>
                Vayrex
              </a>
            </span>
          )}
        </div>
      </footer>

      {/* ── Responsive styles ─────────────────────────────────────────────── */}
      <style>{`
        .nav-desktop { display: flex !important; }
        .nav-mobile-btn { display: none !important; }
        .nav-mobile-menu { display: block; }
        @media (max-width: 768px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-btn { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

export default TenantHome;
