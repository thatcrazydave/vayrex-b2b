/**
 * OrgSetupWizard — 6-step onboarding wizard for org owners
 *
 * Step 1: Confirm slug / subdomain
 * Step 2: Verify email domain (DNS TXT)
 * Step 3: Create first academic year
 * Step 4: Add classrooms + subjects
 * Step 5: Brand your portal
 * Step 6: Go live
 *
 * Requires: user logged in as org owner (organizationId + orgRole === 'owner')
 */
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FiCheckCircle, FiArrowRight, FiPlus, FiX } from 'react-icons/fi';
import api from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const STEP_LABELS = [
  'Confirm URL',
  'Email Domain',
  'Academic Year',
  'Classes & Subjects',
  'Brand Portal',
  'Go Live',
];

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

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
  const [searchParams] = useSearchParams();
  // On the platform host the email link provides ?orgId=...
  // On the tenant host the URL has no query param — fall back to the
  // authenticated user's own organisation.
  const orgId = searchParams.get('orgId') || user?.organizationId;

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
  const [createdYearId, setCreatedYearId] = useState(null);

  // Step 4
  const [className, setClassName] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [classes, setClasses] = useState([]);
  const [subjectName, setSubjectName] = useState('');
  const [subjects, setSubjects] = useState([]);

  // Step 5 — branding
  const [branding, setBranding] = useState({
    displayName:  '',
    tagline:      '',
    primaryColor: '#2563eb',
    accentColor:  '#10b981',
    logoUrl:      '',
  });

  // ── Load org on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    api.get(`/org/${orgId}/profile`)
      .then((res) => {
        const loadedOrg = res.data.org || res.data;
        setOrg(loadedOrg);
        const dbStep = loadedOrg.setupStep || 1;
        // If they completed setup (step 6) but somehow re-entered, send to admin
        setStep(dbStep >= 6 ? 6 : dbStep);
      })
      .catch(() => {/* org load errors are non-fatal at this stage */});

    // Pre-populate branding if any was already saved
    api.get(`/org/${orgId}/branding`)
      .then((res) => {
        const b = res.data?.branding ?? {};
        setBranding({
          displayName:  b.displayName  ?? '',
          tagline:      b.tagline      ?? '',
          primaryColor: b.primaryColor ?? '#2563eb',
          accentColor:  b.accentColor  ?? '#10b981',
          logoUrl:      b.logoUrl      ?? '',
        });
      })
      .catch(() => {});
  }, [orgId]);

  async function getCSRF() {
    const r = await api.get('/csrf-token');
    return r.data.csrfToken;
  }

  // ── Step helpers ──────────────────────────────────────────────────────────

  async function confirmSlug() {
    // Kick off DNS/Netlify provisioning immediately so it can propagate
    // while the owner completes the remaining steps. Fire-and-forget.
    try {
      const csrf = await getCSRF();
      api.post('/onboarding/org/pre-provision', {}, { headers: { 'X-CSRF-Token': csrf } })
        .catch(() => {/* non-fatal — will retry at go-live */});
    } catch (_) { /* non-fatal */ }
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
      const yearRes = await api.post(`/org/${orgId}/academic-years`, { name: yearName, startDate: yearStart, endDate: yearEnd }, { headers: { 'X-CSRF-Token': csrf } });
      const newYearId = yearRes.data.academicYear?._id || yearRes.data._id || null;
      setCreatedYearId(newYearId);
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
      const res = await api.post(`/org/${orgId}/classrooms`, { name: className.trim(), level: classLevel.trim() || className.trim(), ...(createdYearId ? { academicYearId: createdYearId } : {}) }, { headers: { 'X-CSRF-Token': csrf } });
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

  async function saveBranding(skipToNext = false) {
    if (branding.primaryColor && !COLOR_RE.test(branding.primaryColor)) {
      return toast.error('Primary colour must be a valid hex code (e.g. #2563eb)');
    }
    if (branding.accentColor && !COLOR_RE.test(branding.accentColor)) {
      return toast.error('Accent colour must be a valid hex code');
    }
    setLoading(true);
    try {
      const csrf = await getCSRF();
      await api.patch(`/org/${orgId}/branding`, {
        displayName:  branding.displayName  || null,
        tagline:      branding.tagline      || null,
        primaryColor: branding.primaryColor || '#2563eb',
        accentColor:  branding.accentColor  || '#10b981',
        logoUrl:      branding.logoUrl      || null,
      }, { headers: { 'X-CSRF-Token': csrf } });
      toast.success('Branding saved!');
      setStep(6);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to save branding');
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
      setStep(6);
      // Always redirect to the tenant subdomain — works whether the wizard ran
      // on the platform host (/org-setup?orgId=...) or the tenant host (/org-setup).
      const subdomain = org?.subdomain || `${org?.slug}.madebyovo.me`;
      setTimeout(() => { window.location.replace(`https://${subdomain}/org-admin`); }, 2500);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Setup completion failed');
    } finally {
      setLoading(false);
    }
  }

  // ── Progress bar ──────────────────────────────────────────────────────────
  function ProgressBar() {
    const pct = Math.round((step / STEP_LABELS.length) * 100);
    return (
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#555', letterSpacing: '0.01em' }}>
            {STEP_LABELS[step - 1]}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#111', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
            {step}/{STEP_LABELS.length}
          </span>
        </div>
        <div style={{ height: 5, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: '#111',
            borderRadius: 999,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>
    );
  }

  // ── Render steps ──────────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <WizardShell>
        <ProgressBar />
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
        <ProgressBar />
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
        <ProgressBar />
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
        <ProgressBar />
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
    const setB = (key) => (val) => setBranding((b) => ({ ...b, [key]: val }));
    const primary = branding.primaryColor || '#2563eb';
    const accent  = branding.accentColor  || '#10b981';

    return (
      <WizardShell>
        <ProgressBar />
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Brand Your Portal</h2>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 28 }}>
          Customise how your school portal looks before it goes live. You can always update this later from <em>Settings → Branding</em>.
        </p>

        {/* Identity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
          <label style={labelStyle}>
            School Display Name
            <input
              value={branding.displayName}
              onChange={(e) => setB('displayName')(e.target.value)}
              placeholder={org?.name || 'Greenfield Academy'}
              style={inputStyle()}
            />
          </label>
          <label style={labelStyle}>
            Tagline
            <input
              value={branding.tagline}
              onChange={(e) => setB('tagline')(e.target.value)}
              placeholder="Shaping tomorrow's leaders"
              style={inputStyle()}
            />
          </label>
          <label style={labelStyle}>
            Logo URL <span style={{ fontWeight: 400, color: '#888' }}>(optional)</span>
            <input
              value={branding.logoUrl}
              onChange={(e) => setB('logoUrl')(e.target.value)}
              placeholder="https://…/school-logo.png"
              style={inputStyle()}
            />
          </label>
          {branding.logoUrl && (
            <img
              src={branding.logoUrl}
              alt="Logo preview"
              style={{ maxHeight: 64, maxWidth: 180, objectFit: 'contain', borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          )}
        </div>

        {/* Colours */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ ...labelStyle, marginBottom: 12 }}>Brand Colours</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { label: 'Primary', key: 'primaryColor', val: primary },
              { label: 'Accent',  key: 'accentColor',  val: accent  },
            ].map(({ label, key, val }) => (
              <div key={key}>
                <label style={{ fontSize: 13, color: '#555', display: 'block', marginBottom: 6 }}>{label}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={val}
                    onChange={(e) => setB(key)(e.target.value)}
                    style={{ width: 36, height: 36, border: 'none', cursor: 'pointer', background: 'none', padding: 0 }}
                  />
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => setB(key)(e.target.value)}
                    placeholder="#2563eb"
                    style={{ ...inputStyle({ marginTop: 0, fontFamily: 'monospace', flex: 1 }) }}
                  />
                </div>
              </div>
            ))}
          </div>
          {/* Live swatch */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1, height: 36, borderRadius: 8, background: primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Primary</span>
            </div>
            <div style={{ flex: 1, height: 36, borderRadius: 8, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Accent</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Btn onClick={() => saveBranding()} disabled={loading}>
            {loading ? 'Saving…' : <>Save & Continue <FiArrowRight size={14} /></>}
          </Btn>
          <Btn variant="ghost" onClick={() => setStep(6)}>Skip for now</Btn>
        </div>
      </WizardShell>
    );
  }

  if (step === 6) {
    return (
      <WizardShell>
        <ProgressBar />
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
