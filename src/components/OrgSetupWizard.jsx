/**
 * OrgSetupWizard — 5-step onboarding wizard for org owners
 *
 * Step 1: Confirm slug / subdomain
 * Step 2: Verify email domain (DNS TXT)
 * Step 3: Create first academic year
 * Step 4: Add classrooms + subjects
 * Step 5: Go live
 *
 * Requires: user logged in as org owner (organizationId + orgRole === 'owner')
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FiCheckCircle, FiCircle, FiArrowRight, FiPlus, FiX } from 'react-icons/fi';
import api from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const STEP_LABELS = [
  'Confirm URL',
  'Email Domain',
  'Academic Year',
  'Classes & Subjects',
  'Go Live',
];

// ── utility ──────────────────────────────────────────────────────────────────
function inputStyle(extra = {}) {
  return {
    display: 'block',
    width: '100%',
    padding: '10px 13px',
    border: '1.5px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    marginTop: 6,
    ...extra,
  };
}
const labelStyle = { fontSize: 14, fontWeight: 600, color: '#333', display: 'block', marginBottom: 4 };
const cardStyle = { background: 'white', borderRadius: 16, padding: 36, maxWidth: 560, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' };

// ── Main ─────────────────────────────────────────────────────────────────────
function OrgSetupWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orgId = searchParams.get('orgId');

  const [step, setStep] = useState(1);
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(false);

  // Step 2
  const [domain, setDomain] = useState('');
  const [domainVerified, setDomainVerified] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  // Step 3
  const [yearName, setYearName] = useState('');
  const [yearStart, setYearStart] = useState('');
  const [yearEnd, setYearEnd] = useState('');
  const [yearCreated, setYearCreated] = useState(false);

  // Step 4
  const [className, setClassName] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [classes, setClasses] = useState([]);
  const [subjectName, setSubjectName] = useState('');
  const [subjects, setSubjects] = useState([]);

  // ── Load org on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    api.get(`/org/${orgId}/profile`)
      .then((res) => {
        setOrg(res.data.org || res.data);
        setStep(res.data.org?.setupStep || res.data.setupStep || 1);
      })
      .catch(() => {/* org load errors are non-fatal at this stage */});
  }, [orgId]);

  async function getCSRF() {
    const r = await api.get('/csrf-token');
    return r.data.csrfToken;
  }

  // ── Step helpers ──────────────────────────────────────────────────────────

  async function confirmSlug() {
    setStep(2);
  }

  async function verifyDomain() {
    if (!domain.trim()) return toast.error('Enter your school email domain');
    setLoading(true);
    try {
      const csrf = await getCSRF();
      const res = await api.post('/onboarding/org/verify-domain', { domain: domain.trim() }, { headers: { 'X-CSRF-Token': csrf } });
      setVerifyResult(res.data);
      if (res.data.verified) {
        setDomainVerified(true);
        toast.success('Domain verified!');
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Verification failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function provisionEmail() {
    setLoading(true);
    try {
      const csrf = await getCSRF();
      await api.post('/onboarding/org/provision-email', {}, { headers: { 'X-CSRF-Token': csrf } });
      toast.success('Email domain provisioned');
      setStep(3);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Provisioning failed');
    } finally {
      setLoading(false);
    }
  }

  async function createAcademicYear() {
    if (!yearName.trim() || !yearStart || !yearEnd) return toast.error('Fill in all academic year fields');
    if (new Date(yearEnd) <= new Date(yearStart)) return toast.error('End date must be after start date');
    setLoading(true);
    try {
      const csrf = await getCSRF();
      await api.post(`/org/${orgId}/academic-years`, { name: yearName, startDate: yearStart, endDate: yearEnd }, { headers: { 'X-CSRF-Token': csrf } });
      setYearCreated(true);
      toast.success('Academic year created');
      setStep(4);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to create academic year');
    } finally {
      setLoading(false);
    }
  }

  async function addClass() {
    if (!className.trim()) return toast.error('Class name is required');
    setLoading(true);
    try {
      const csrf = await getCSRF();
      const res = await api.post(`/org/${orgId}/classrooms`, { name: className.trim(), level: classLevel.trim() || className.trim() }, { headers: { 'X-CSRF-Token': csrf } });
      setClasses((prev) => [...prev, res.data.classroom || { name: className, level: classLevel }]);
      setClassName('');
      setClassLevel('');
      toast.success('Classroom added');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to add classroom');
    } finally {
      setLoading(false);
    }
  }

  async function addSubject() {
    if (!subjectName.trim()) return toast.error('Subject name is required');
    setLoading(true);
    try {
      const csrf = await getCSRF();
      const res = await api.post(`/org/${orgId}/subjects`, { name: subjectName.trim() }, { headers: { 'X-CSRF-Token': csrf } });
      setSubjects((prev) => [...prev, res.data.subject || { name: subjectName }]);
      setSubjectName('');
      toast.success('Subject added');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to add subject');
    } finally {
      setLoading(false);
    }
  }

  async function goLive() {
    setLoading(true);
    try {
      const csrf = await getCSRF();
      const res = await api.post('/onboarding/org/setup-complete', {}, { headers: { 'X-CSRF-Token': csrf } });
      toast.success(res.data.message || 'Your school is now live!');
      setStep(5);
      setTimeout(() => navigate('/org-admin'), 2500);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Setup completion failed');
    } finally {
      setLoading(false);
    }
  }

  // ── Stepper ───────────────────────────────────────────────────────────────
  function StepIndicator() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 40, justifyContent: 'center', flexWrap: 'wrap', rowGap: 8 }}>
        {STEP_LABELS.map((label, i) => {
          const num = i + 1;
          const done = step > num;
          const active = step === num;
          return (
            <React.Fragment key={label}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 64 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? '#16a34a' : active ? '#15803d' : '#e5e7eb',
                  color: done || active ? 'white' : '#9ca3af', fontWeight: 700, fontSize: 13,
                }}>
                  {done ? <FiCheckCircle size={16} /> : num}
                </div>
                <span style={{ fontSize: 11, color: active ? '#15803d' : '#9ca3af', fontWeight: active ? 700 : 400, textAlign: 'center', whiteSpace: 'nowrap' }}>{label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: done ? '#16a34a' : '#e5e7eb', minWidth: 16, maxWidth: 48, marginBottom: 18 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── Render steps ──────────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <WizardShell>
        <StepIndicator />
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Confirm Your School URL</h2>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
          This is the URL your school will use to access Vayrex. It cannot be changed after setup.
        </p>
        {org && (
          <div style={{ background: '#f0fdf4', border: '2px solid #16a34a', borderRadius: 10, padding: 20, marginBottom: 28 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#555' }}>Your school portal URL</p>
            <p style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 700, color: '#15803d', fontFamily: 'monospace' }}>
              https://{org.subdomain || `${org.slug}.madebyovo.me`}
            </p>
          </div>
        )}
        <Btn onClick={confirmSlug}>Confirm &amp; Continue <FiArrowRight size={14} /></Btn>
      </WizardShell>
    );
  }

  if (step === 2) {
    const expectedRecord = verifyResult?.expectedRecord || `vayrex-verify=${orgId}`;
    return (
      <WizardShell>
        <StepIndicator />
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Verify Email Domain</h2>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
          Add a DNS TXT record to prove you own your school's email domain. This enables school-wide email features.
          <br /><em style={{ fontSize: 12 }}>You can skip this step and do it later from Settings.</em>
        </p>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>
            School Email Domain
            <input
              value={domain}
              onChange={(e) => { setDomain(e.target.value); setVerifyResult(null); setDomainVerified(false); }}
              placeholder="yourschool.edu.ng"
              style={inputStyle()}
            />
          </label>
        </div>

        {verifyResult && !verifyResult.verified && (
          <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 14 }}>Add this TXT record to your DNS provider:</p>
            <code style={{ display: 'block', background: '#f5f5f5', padding: '8px 12px', borderRadius: 6, fontSize: 13, wordBreak: 'break-all' }}>
              {expectedRecord}
            </code>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#666' }}>DNS changes can take up to 24 hours to propagate. Click Verify again once added.</p>
          </div>
        )}
        {domainVerified && (
          <div style={{ background: '#f0fdf4', border: '1px solid #16a34a', borderRadius: 8, padding: 16, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <FiCheckCircle size={20} color="#16a34a" />
            <span style={{ fontSize: 14, color: '#2e7d32', fontWeight: 600 }}>Domain verified! Click Provision to continue.</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {!domainVerified && <Btn onClick={verifyDomain} disabled={loading}>{loading ? 'Verifying…' : 'Verify Domain'}</Btn>}
          {domainVerified && <Btn onClick={provisionEmail} disabled={loading}>{loading ? 'Provisioning…' : 'Provision & Continue'} <FiArrowRight size={14} /></Btn>}
          <Btn variant="ghost" onClick={() => setStep(3)}>Skip for now</Btn>
        </div>
      </WizardShell>
    );
  }

  if (step === 3) {
    return (
      <WizardShell>
        <StepIndicator />
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Create Academic Year</h2>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>Set up your current academic year (e.g. 2025/2026).</p>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Academic Year Name *
            <input value={yearName} onChange={(e) => setYearName(e.target.value)} placeholder="e.g. 2025/2026" style={inputStyle()} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <label style={labelStyle}>
            Start Date *
            <input type="date" value={yearStart} onChange={(e) => setYearStart(e.target.value)} style={inputStyle()} />
          </label>
          <label style={labelStyle}>
            End Date *
            <input type="date" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} style={inputStyle()} />
          </label>
        </div>
        <Btn onClick={createAcademicYear} disabled={loading}>{loading ? 'Creating…' : 'Create & Continue'} <FiArrowRight size={14} /></Btn>
      </WizardShell>
    );
  }

  if (step === 4) {
    return (
      <WizardShell>
        <StepIndicator />
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Add Classrooms &amp; Subjects</h2>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>Add at least one classroom and one subject to continue.</p>

        {/* Classrooms */}
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Classrooms</h3>
          {classes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {classes.map((c, i) => (
                <span key={i} style={{ background: '#e8f5e9', color: '#2e7d32', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Class name (e.g. JSS1A)" style={{ ...inputStyle(), flex: 2 }} />
            <input value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="Level (e.g. JSS1)" style={{ ...inputStyle(), flex: 1 }} />
            <button onClick={addClass} disabled={loading} style={{ padding: '10px 16px', background: '#16a34a', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <FiPlus size={14} /> Add
            </button>
          </div>
        </div>

        {/* Subjects */}
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Subjects</h3>
          {subjects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {subjects.map((s, i) => (
                <span key={i} style={{ background: '#dcfce7', color: '#15803d', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>{s.name}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="Subject name (e.g. Mathematics)" style={{ ...inputStyle(), flex: 1 }} />
            <button onClick={addSubject} disabled={loading} style={{ padding: '10px 16px', background: '#16a34a', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <FiPlus size={14} /> Add
            </button>
          </div>
        </div>

        <Btn onClick={() => setStep(5)} disabled={classes.length === 0 || subjects.length === 0}>
          {classes.length === 0 || subjects.length === 0 ? 'Add at least 1 class and 1 subject to continue' : <>Continue <FiArrowRight size={14} /></>}
        </Btn>
      </WizardShell>
    );
  }

  if (step === 5) {
    return (
      <WizardShell>
        <StepIndicator />
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Go Live</h2>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 32 }}>
          Everything looks good. Clicking the button below will activate your school portal and make it accessible to your staff and students.
        </p>
        <div style={{ background: '#f0fdf4', border: '2px solid #16a34a', borderRadius: 10, padding: 20, marginBottom: 32 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: '#555' }}>Your school portal will be live at</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#15803d', fontFamily: 'monospace' }}>
            https://{org?.subdomain || `${org?.slug}.madebyovo.me`}
          </p>
        </div>
        <Btn onClick={goLive} disabled={loading}>
          {loading ? 'Activating…' : <><FiCheckCircle size={16} /> Activate &amp; Go Live</>}
        </Btn>
      </WizardShell>
    );
  }

  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function WizardShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px' }}>
      <div style={cardStyle}>{children}</div>
    </div>
  );
}

function Btn({ children, onClick, disabled = false, variant = 'primary' }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '12px 24px', borderRadius: 8, fontWeight: 700, fontSize: 15,
    cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
  };
  const styles = {
    primary: { ...base, background: disabled ? '#86efac' : '#16a34a', color: 'white' },
    ghost: { ...base, background: 'transparent', color: '#16a34a', textDecoration: 'underline', padding: '12px 4px' },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={styles[variant]}>
      {children}
    </button>
  );
}

export default OrgSetupWizard;
