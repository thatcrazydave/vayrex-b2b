/**
 * BrandingManager.jsx
 *
 * UI for owners / org_admins to customise their school's branding:
 *   - Display name & tagline
 *   - Login hero text
 *   - Primary / accent colours
 *   - Logo and favicon (URL input; S3 upload can be wired here later)
 *   - Hide Vayrex branding flag (owner-only)
 *
 * Calls PATCH /api/org/:orgId/branding and calls refreshBranding() from
 * TenantContext so the change is reflected immediately without a page reload.
 *
 * Route: /org-admin/branding  (gated to owner, org_admin in App.jsx)
 */

import React, { useEffect, useState } from 'react';
import { FiSave, FiEye, FiRefreshCw } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTenant } from '../contexts/TenantContext.jsx';
import API from '../services/api';
import { showToast } from '../utils/toast';

const FIELD_MAX = 500;
const COLOR_RE  = /^#[0-9a-fA-F]{3,8}$/;

function ColorInput({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="color"
          value={value || '#2563eb'}
          onChange={e => onChange(e.target.value)}
          style={{ width: 40, height: 36, border: 'none', cursor: 'pointer', background: 'none', padding: 0 }}
        />
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="#2563eb"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 14,
            fontFamily: 'monospace',
          }}
        />
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, multiline }) {
  const style = {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    resize: multiline ? 'vertical' : undefined,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</label>
      {multiline ? (
        <textarea
          value={value || ''}
          onChange={e => onChange(e.target.value.slice(0, FIELD_MAX))}
          placeholder={placeholder}
          rows={3}
          style={style}
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value.slice(0, FIELD_MAX))}
          placeholder={placeholder}
          style={style}
        />
      )}
    </div>
  );
}

function BrandingManager() {
  const { user }             = useAuth();
  const { tenant, refreshBranding } = useTenant();
  const orgId = user?.organizationId;
  const isOwner = user?.orgRole === 'owner';

  const [form, setForm] = useState({
    displayName:        '',
    tagline:            '',
    loginHeroText:      '',
    primaryColor:       '#2563eb',
    accentColor:        '#10b981',
    logoUrl:            '',
    faviconUrl:         '',
    hideVayrexBranding: false,
  });
  const [saving,   setSaving]   = useState(false);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!orgId) return;
    API.get(`/org/${orgId}/branding`)
      .then(res => {
        const b = res.data?.branding ?? {};
        setForm({
          displayName:        b.displayName        ?? '',
          tagline:            b.tagline            ?? '',
          loginHeroText:      b.loginHeroText      ?? '',
          primaryColor:       b.primaryColor       ?? '#2563eb',
          accentColor:        b.accentColor        ?? '#10b981',
          logoUrl:            b.logoUrl            ?? '',
          faviconUrl:         b.faviconUrl         ?? '',
          hideVayrexBranding: b.hideVayrexBranding ?? false,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  const set = (key) => (val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (form.primaryColor && !COLOR_RE.test(form.primaryColor)) {
      showToast.error('Primary colour must be a valid hex code (e.g. #2563eb)');
      return;
    }
    if (form.accentColor && !COLOR_RE.test(form.accentColor)) {
      showToast.error('Accent colour must be a valid hex code');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        displayName:   form.displayName   || null,
        tagline:       form.tagline       || null,
        loginHeroText: form.loginHeroText || null,
        primaryColor:  form.primaryColor,
        accentColor:   form.accentColor,
        logoUrl:       form.logoUrl       || null,
        faviconUrl:    form.faviconUrl    || null,
      };
      if (isOwner) payload.hideVayrexBranding = form.hideVayrexBranding;

      const res = await API.patch(`/org/${orgId}/branding`, payload);
      showToast.success('Branding saved');
      refreshBranding(res.data.branding);
    } catch (err) {
      showToast.error(err?.response?.data?.error?.message ?? 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
        <FiRefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading branding settings…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>School Branding</h1>
        <p style={{ color: '#64748b', marginTop: 6, fontSize: 14 }}>
          Customise how your school appears to students, staff and guardians.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ── Identity ── */}
        <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 18px' }}>School Identity</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <TextInput label="Display name" value={form.displayName} onChange={set('displayName')} placeholder="Greenfield Academy" />
            <TextInput label="Tagline" value={form.tagline} onChange={set('tagline')} placeholder="Shaping tomorrow's leaders" />
            <TextInput label="Login hero text" value={form.loginHeroText} onChange={set('loginHeroText')} placeholder="Welcome! Sign in to access your classes, grades and more." multiline />
          </div>
        </section>

        {/* ── Colours ── */}
        <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 18px' }}>Brand Colours</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ColorInput label="Primary colour" value={form.primaryColor} onChange={set('primaryColor')} />
            <ColorInput label="Accent colour"  value={form.accentColor}  onChange={set('accentColor')}  />
          </div>
          {/* Live swatch preview */}
          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, height: 40, borderRadius: 8, background: form.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Primary</span>
            </div>
            <div style={{ flex: 1, height: 40, borderRadius: 8, background: form.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Accent</span>
            </div>
          </div>
        </section>

        {/* ── Assets ── */}
        <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>Logo & Favicon</h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>Paste the public URL of your school logo and favicon. (S3-hosted upload coming soon.)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <TextInput label="Logo URL" value={form.logoUrl} onChange={set('logoUrl')} placeholder="https://…/greenfield-logo.png" />
            {form.logoUrl && (
              <img src={form.logoUrl} alt="Logo preview" style={{ maxHeight: 72, maxWidth: 200, objectFit: 'contain', borderRadius: 6, border: '1px solid #e2e8f0' }} />
            )}
            <TextInput label="Favicon URL" value={form.faviconUrl} onChange={set('faviconUrl')} placeholder="https://…/favicon.ico" />
          </div>
        </section>

        {/* ── Enterprise ── */}
        {isOwner && (
          <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: '0 0 16px' }}>White-label</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.hideVayrexBranding}
                onChange={e => setForm(f => ({ ...f, hideVayrexBranding: e.target.checked }))}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 14, color: '#374151' }}>
                Hide "Powered by Vayrex" footer on the tenant landing page
              </span>
            </label>
          </section>
        )}

        {/* ── Save ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: form.primaryColor || '#2563eb',
              color: '#fff',
              border: 'none',
              padding: '12px 28px',
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 15,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            <FiSave size={16} />
            {saving ? 'Saving…' : 'Save branding'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BrandingManager;
