import React, { useState, useEffect } from 'react';
import API from '../../services/api.js';
import { showToast } from '../../utils/toast.js';
import { FiDollarSign, FiSave, FiRefreshCw, FiEdit2, FiCheck, FiX } from 'react-icons/fi';

const CURRENCY_LABELS = {
  NGN: 'Nigerian Naira (₦)',
  GBP: 'British Pound (£)',
  EUR: 'Euro (€)',
  CAD: 'Canadian Dollar (C$)',
  INR: 'Indian Rupee (₹)',
  GHS: 'Ghanaian Cedi (GH₵)',
  ZAR: 'South African Rand (R)',
  KES: 'Kenyan Shilling (KSh)'
};

const PricingManager = () => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTier, setEditingTier] = useState(null);
  const [editingRates, setEditingRates] = useState(false);
  const [tierDraft, setTierDraft] = useState({});
  const [ratesDraft, setRatesDraft] = useState({});

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await API.get('/admin/pricing-config');
      if (res.data.success) {
        setConfig(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load pricing config:', err);
      showToast.error('Failed to load pricing configuration');
    } finally {
      setLoading(false);
    }
  };

  const startEditTier = (tierName) => {
    const tier = config.tiers[tierName];
    setTierDraft({
      name: tier.name,
      description: tier.description,
      monthlyUSD: tier.monthlyUSD,
      yearlyUSD: tier.yearlyUSD,
      features: [...(tier.features || [])],
      limits: { ...(tier.limits || {}) }
    });
    setEditingTier(tierName);
  };

  const cancelEditTier = () => {
    setEditingTier(null);
    setTierDraft({});
  };

  const saveTier = async () => {
    try {
      setSaving(true);
      const updates = {
        tiers: {
          ...config.tiers,
          [editingTier]: {
            ...config.tiers[editingTier],
            ...tierDraft
          }
        }
      };

      const res = await API.put('/admin/pricing-config', updates);
      if (res.data.success) {
        setConfig(res.data.data);
        setEditingTier(null);
        setTierDraft({});
        showToast.success(`${editingTier} tier updated successfully`);
      }
    } catch (err) {
      console.error('Failed to update tier:', err);
      showToast.error(err.response?.data?.error?.message || 'Failed to update tier');
    } finally {
      setSaving(false);
    }
  };

  const startEditRates = () => {
    const rates = { ...config.exchangeRates };
    delete rates.lastUpdated;
    delete rates._id;
    setRatesDraft(rates);
    setEditingRates(true);
  };

  const cancelEditRates = () => {
    setEditingRates(false);
    setRatesDraft({});
  };

  const saveRates = async () => {
    try {
      setSaving(true);
      const res = await API.put('/admin/exchange-rates', { rates: ratesDraft });
      if (res.data.success) {
        await fetchConfig(); // Refresh full config
        setEditingRates(false);
        setRatesDraft({});
        showToast.success('Exchange rates updated');
      }
    } catch (err) {
      console.error('Failed to update rates:', err);
      showToast.error(err.response?.data?.error?.message || 'Failed to update rates');
    } finally {
      setSaving(false);
    }
  };

  const formatUSD = (cents) => {
    if (!cents && cents !== 0) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const updateFeature = (index, value) => {
    const newFeatures = [...tierDraft.features];
    newFeatures[index] = value;
    setTierDraft(prev => ({ ...prev, features: newFeatures }));
  };

  const addFeature = () => {
    setTierDraft(prev => ({ ...prev, features: [...prev.features, ''] }));
  };

  const removeFeature = (index) => {
    setTierDraft(prev => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== index)
    }));
  };

  if (loading) {
    return (
      <div className="admin-section-loading">
        <div className="spinner"></div>
        <p>Loading pricing configuration...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="admin-empty-state">
        <p>No pricing configuration found.</p>
        <button onClick={fetchConfig} className="btn-primary">
          <FiRefreshCw /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="pricing-manager">
      {/* Tier Pricing Cards */}
      <div className="pm-section">
        <div className="pm-section-header">
          <h3><FiDollarSign /> Tier Pricing</h3>
          <p className="pm-hint">All prices are in USD cents (e.g., 999 = $9.99). Prices are auto-converted for users based on exchange rates below.</p>
        </div>

        <div className="pm-tier-grid">
          {['free', 'starter', 'pro'].map((tierName) => {
            const tier = config.tiers?.[tierName];
            if (!tier) return null;
            const isEditing = editingTier === tierName;

            return (
              <div key={tierName} className={`pm-tier-card ${isEditing ? 'editing' : ''}`}>
                <div className="pm-tier-header">
                  <h4>{tier.name || tierName}</h4>
                  {!isEditing ? (
                    <button className="pm-edit-btn" onClick={() => startEditTier(tierName)} title="Edit">
                      <FiEdit2 />
                    </button>
                  ) : (
                    <div className="pm-edit-actions">
                      <button className="pm-save-btn" onClick={saveTier} disabled={saving} title="Save">
                        <FiCheck />
                      </button>
                      <button className="pm-cancel-btn" onClick={cancelEditTier} title="Cancel">
                        <FiX />
                      </button>
                    </div>
                  )}
                </div>

                {!isEditing ? (
                  <div className="pm-tier-info">
                    <p className="pm-description">{tier.description}</p>
                    <div className="pm-prices">
                      <div className="pm-price-row">
                        <span>Monthly:</span>
                        <strong>{formatUSD(tier.monthlyUSD)}</strong>
                      </div>
                      <div className="pm-price-row">
                        <span>Yearly:</span>
                        <strong>{formatUSD(tier.yearlyUSD)}</strong>
                      </div>
                    </div>
                    <div className="pm-features">
                      <strong>Features:</strong>
                      <ul>
                        {(tier.features || []).map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="pm-tier-edit">
                    <div className="pm-field">
                      <label>Display Name</label>
                      <input
                        type="text"
                        value={tierDraft.name || ''}
                        onChange={(e) => setTierDraft(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                    <div className="pm-field">
                      <label>Description</label>
                      <input
                        type="text"
                        value={tierDraft.description || ''}
                        onChange={(e) => setTierDraft(prev => ({ ...prev, description: e.target.value }))}
                      />
                    </div>
                    <div className="pm-field-row">
                      <div className="pm-field">
                        <label>Monthly (USD cents)</label>
                        <input
                          type="number"
                          min="0"
                          value={tierDraft.monthlyUSD ?? 0}
                          onChange={(e) => setTierDraft(prev => ({ ...prev, monthlyUSD: Number(e.target.value) }))}
                        />
                        <span className="pm-preview">{formatUSD(tierDraft.monthlyUSD)}/mo</span>
                      </div>
                      <div className="pm-field">
                        <label>Yearly (USD cents)</label>
                        <input
                          type="number"
                          min="0"
                          value={tierDraft.yearlyUSD ?? 0}
                          onChange={(e) => setTierDraft(prev => ({ ...prev, yearlyUSD: Number(e.target.value) }))}
                        />
                        <span className="pm-preview">{formatUSD(tierDraft.yearlyUSD)}/yr</span>
                      </div>
                    </div>

                    <div className="pm-section-divider">Limits & Quotas</div>

                    <div className="pm-field-row">
                      <div className="pm-field">
                        <label>Uploads / Month (-1 for ∞)</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.uploadsPerMonth ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, uploadsPerMonth: Number(e.target.value) }
                          }))}
                        />
                      </div>
                      <div className="pm-field">
                        <label>Uploads / Day (-1 for ∞)</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.uploadsPerDay ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, uploadsPerDay: Number(e.target.value) }
                          }))}
                        />
                      </div>
                    </div>

                    <div className="pm-field-row">
                      <div className="pm-field">
                        <label>Max Storage (MB)</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.maxStorageMB ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, maxStorageMB: Number(e.target.value) }
                          }))}
                        />
                      </div>
                      <div className="pm-field">
                        <label>Max File Size (MB)</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.maxFileSizeMB ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, maxFileSizeMB: Number(e.target.value) }
                          }))}
                        />
                      </div>
                    </div>

                    <div className="pm-field-row">
                      <div className="pm-field">
                        <label>Tokens / Month (-1 for ∞)</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.tokensPerMonth ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, tokensPerMonth: Number(e.target.value) }
                          }))}
                        />
                      </div>
                      <div className="pm-field">
                        <label>Tokens / Req</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.tokensPerRequest ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, tokensPerRequest: Number(e.target.value) }
                          }))}
                        />
                      </div>
                    </div>

                    <div className="pm-field-row">
                      <div className="pm-field">
                        <label>Questions / Upload</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.questionsPerUpload ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, questionsPerUpload: Number(e.target.value) }
                          }))}
                        />
                      </div>
                      <div className="pm-field checkbox">
                        <label>
                          <input
                            type="checkbox"
                            checked={tierDraft.limits?.pdfExport ?? false}
                            onChange={(e) => setTierDraft(prev => ({
                              ...prev,
                              limits: { ...prev.limits, pdfExport: e.target.checked }
                            }))}
                          />
                          PDF Export
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={tierDraft.limits?.noteSummary ?? false}
                            onChange={(e) => setTierDraft(prev => ({
                              ...prev,
                              limits: { ...prev.limits, noteSummary: e.target.checked }
                            }))}
                          />
                          AI Summaries
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={tierDraft.limits?.priorityProcessing ?? false}
                            onChange={(e) => setTierDraft(prev => ({
                              ...prev,
                              limits: { ...prev.limits, priorityProcessing: e.target.checked }
                            }))}
                          />
                          Priority Hub
                        </label>
                      </div>
                    </div>

                    <div className="pm-field-row">
                      <div className="pm-field">
                        <label>Reveals / Quiz (-1 for ∞)</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.revealsPerQuiz ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, revealsPerQuiz: Number(e.target.value) }
                          }))}
                        />
                      </div>
                      <div className="pm-field">
                        <label>Max Chat History</label>
                        <input
                          type="number"
                          value={tierDraft.limits?.maxChatHistory ?? 0}
                          onChange={(e) => setTierDraft(prev => ({
                            ...prev,
                            limits: { ...prev.limits, maxChatHistory: Number(e.target.value) }
                          }))}
                        />
                      </div>
                    </div>
                    <div className="pm-field">
                      <label>Features</label>
                      {(tierDraft.features || []).map((f, i) => (
                        <div key={i} className="pm-feature-row">
                          <input
                            type="text"
                            value={f}
                            onChange={(e) => updateFeature(i, e.target.value)}
                            placeholder="Feature description"
                          />
                          <button className="pm-remove-btn" onClick={() => removeFeature(i)}>
                            <FiX />
                          </button>
                        </div>
                      ))}
                      <button className="pm-add-feature-btn" onClick={addFeature}>
                        + Add Feature
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Exchange Rates */}
      <div className="pm-section">
        <div className="pm-section-header">
          <h3><FiRefreshCw /> Exchange Rates (1 USD = ?)</h3>
          {!editingRates ? (
            <button className="pm-edit-btn" onClick={startEditRates}>
              <FiEdit2 /> Edit Rates
            </button>
          ) : (
            <div className="pm-edit-actions">
              <button className="pm-save-btn" onClick={saveRates} disabled={saving}>
                <FiSave /> {saving ? 'Saving...' : 'Save'}
              </button>
              <button className="pm-cancel-btn" onClick={cancelEditRates}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {config.exchangeRates?.lastUpdated && (
          <p className="pm-last-updated">
            Last updated: {new Date(config.exchangeRates.lastUpdated).toLocaleString()}
          </p>
        )}

        <div className="pm-rates-grid">
          {Object.entries(CURRENCY_LABELS).map(([code, label]) => {
            const currentRate = config.exchangeRates?.[code];
            return (
              <div key={code} className="pm-rate-item">
                <label>{label}</label>
                {!editingRates ? (
                  <span className="pm-rate-value">{currentRate ?? 'N/A'}</span>
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={ratesDraft[code] ?? currentRate ?? ''}
                    onChange={(e) => setRatesDraft(prev => ({ ...prev, [code]: Number(e.target.value) }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PricingManager;
