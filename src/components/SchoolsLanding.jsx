import React from 'react';
import { Link } from 'react-router-dom';
import { FiCheckCircle, FiArrowRight, FiUsers, FiBookOpen, FiBarChart2, FiShield } from 'react-icons/fi';

const FEATURES = [
  {
    icon: <FiUsers size={24} />,
    title: 'Full Staff & Student Management',
    desc: 'Invite teachers, students, and guardians with role-based access. Assign classes, subjects, and permissions in minutes.',
  },
  {
    icon: <FiBookOpen size={24} />,
    title: 'Academic Calendar',
    desc: 'Manage academic years and terms. Open and close terms, archive data, and track progress year over year.',
  },
  {
    icon: <FiBarChart2 size={24} />,
    title: 'AI-Powered Assessment',
    desc: 'Teachers generate subject-specific quizzes from uploaded materials. Students practice anytime, anywhere.',
  },
  {
    icon: <FiShield size={24} />,
    title: 'Secure & School-Branded',
    desc: 'Your school gets its own subdomain (yourschool.madebyovo.me). All data is tenant-isolated and encrypted.',
  },
];

const INCLUDED = [
  'Up to 200 seats on Starter',
  'Unlimited classrooms and subjects',
  'Guardian portal',
  'Report cards and grade management',
  'CSV bulk import for staff and students',
  'Dedicated school subdomain',
  'Priority support',
];

function SchoolsLanding() {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0a0a0a' }}>
      {/* ── Hero ── */}
      <section style={{ background: 'linear-gradient(135deg, #15803d 0%, #166534 100%)', color: 'white', padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.12)', borderRadius: 20, padding: '4px 16px', fontSize: 13, marginBottom: 24 }}>
            Vayrex for Schools
          </span>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', fontWeight: 800, lineHeight: 1.2, margin: '0 0 20px' }}>
            The All-in-One EMS Built for Nigerian Schools
          </h1>
          <p style={{ fontSize: 18, opacity: 0.85, lineHeight: 1.7, margin: '0 0 40px' }}>
            Manage your entire school — staff, students, classes, assessments and results — from a single platform powered by AI.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/org-signup"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#16a34a', color: 'white', padding: '14px 32px', borderRadius: 8, textDecoration: 'none', fontWeight: 700, fontSize: 16 }}
            >
              Get Started Free <FiArrowRight size={16} />
            </Link>
            <Link
              to="/contact"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.1)', color: 'white', padding: '14px 32px', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 16, border: '1px solid rgba(255,255,255,0.2)' }}
            >
              Talk to Sales
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={{ padding: '80px 24px', background: '#f9f9f9' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Everything Your School Needs</h2>
          <p style={{ textAlign: 'center', color: '#666', marginBottom: 56, fontSize: 16 }}>
            Purpose-built for secondary and primary schools in Nigeria.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ background: 'white', borderRadius: 12, padding: 28, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <div style={{ color: '#16a34a', marginBottom: 16 }}>{f.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{f.title}</h3>
                <p style={{ color: '#666', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What's Included ── */}
      <section style={{ padding: '80px 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 48 }}>What's Included on Every Plan</h2>
          <div style={{ textAlign: 'left', display: 'inline-block' }}>
            {INCLUDED.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 15 }}>
                <FiCheckCircle size={18} color="#16a34a" style={{ flexShrink: 0 }} />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 56 }}>
            <Link
              to="/org-signup"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0a0a0a', color: 'white', padding: '16px 40px', borderRadius: 8, textDecoration: 'none', fontWeight: 700, fontSize: 17 }}
            >
              Register Your School <FiArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SchoolsLanding;
