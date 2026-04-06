/**
 * TenantContext.jsx
 *
 * Resolves the current tenant (school) from the window hostname on app mount
 * by calling GET /api/public/org-by-host.
 *
 * Exposes:
 *   tenant       — the org object (id, name, slug, branding, …) or null for platform host
 *   isTenantHost — true when we are on a subdomain that resolved to an active org
 *   loading      — true while the first fetch is in flight
 *
 * Side effects on resolved tenant:
 *   - Sets document.title to the school display name / name
 *   - Swaps the favicon if branding.faviconUrl is set
 *   - Injects --brand-primary and --brand-accent CSS custom properties so all
 *     components can consume them via var(--brand-primary) in CSS/inline styles
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import API from '../services/api';

const TenantContext = createContext(null);

export const useTenant = () => {
  const ctx = useContext(TenantContext);
  if (ctx === null) throw new Error('useTenant must be used inside <TenantProvider>');
  return ctx;
};

function applyBranding(branding, orgName) {
  // CSS custom properties
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', branding.primaryColor || '#2563eb');
  root.style.setProperty('--brand-accent',  branding.accentColor  || '#10b981');

  // Page title
  const title = branding.displayName || orgName;
  if (title) document.title = title;

  // Favicon
  if (branding.faviconUrl) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = branding.faviconUrl;
  }
}

function resetBranding() {
  const root = document.documentElement;
  root.style.removeProperty('--brand-primary');
  root.style.removeProperty('--brand-accent');
}

export const TenantProvider = ({ children }) => {
  const [tenant,       setTenant]       = useState(null);
  const [isTenantHost, setIsTenantHost] = useState(false);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    let cancelled = false;

    API.get('/public/org-by-host')
      .then(res => {
        if (cancelled) return;
        const org = res.data?.org ?? null;
        setTenant(org);
        setIsTenantHost(!!org);
        if (org) applyBranding(org.branding ?? {}, org.name);
        else resetBranding();
      })
      .catch(() => {
        if (!cancelled) {
          setTenant(null);
          setIsTenantHost(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Allow live branding refresh (called by BrandingManager after a save)
  const refreshBranding = (newBranding) => {
    setTenant(prev => {
      if (!prev) return prev;
      const updated = { ...prev, branding: { ...prev.branding, ...newBranding } };
      applyBranding(updated.branding, updated.name);
      return updated;
    });
  };

  return (
    <TenantContext.Provider value={{ tenant, isTenantHost, loading, refreshBranding }}>
      {children}
    </TenantContext.Provider>
  );
};

export default TenantContext;
