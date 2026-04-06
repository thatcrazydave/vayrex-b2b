import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { showToast } from '../utils/toast';
import {
  FiArrowLeft, FiPlus, FiTrash2, FiSave, FiRefreshCw, FiAward,
  FiSliders, FiCheck, FiAlertCircle, FiMove,
} from 'react-icons/fi';

// ─── Default templates schools can pick from ──────────────────────────────────
const PRESETS = {
  nigerian_waec: {
    label: 'Nigerian WAEC (A1–F9)',
    components: [
      { name: 'CA1',     maxScore: 100, isExam: false, order: 0 },
      { name: 'CA2',     maxScore: 100, isExam: false, order: 1 },
      { name: 'MidTerm', maxScore: 100, isExam: false, order: 2 },
      { name: 'Exam',    maxScore: 100, isExam: true,  order: 3 },
    ],
    caWeight: 40,
    boundaries: [
      { grade: 'A1', min: 75, max: 100, remark: 'Excellent',  points: 1 },
      { grade: 'B2', min: 70, max: 74,  remark: 'Very Good',  points: 2 },
      { grade: 'B3', min: 65, max: 69,  remark: 'Good',       points: 3 },
      { grade: 'C4', min: 60, max: 64,  remark: 'Credit',     points: 4 },
      { grade: 'C5', min: 55, max: 59,  remark: 'Credit',     points: 5 },
      { grade: 'C6', min: 50, max: 54,  remark: 'Credit',     points: 6 },
      { grade: 'D7', min: 45, max: 49,  remark: 'Pass',       points: 7 },
      { grade: 'E8', min: 40, max: 44,  remark: 'Pass',       points: 8 },
      { grade: 'F9', min: 0,  max: 39,  remark: 'Fail',       points: 9 },
    ],
  },
  abc_simple: {
    label: 'Simple A–F (US style)',
    components: [
      { name: 'Test 1', maxScore: 100, isExam: false, order: 0 },
      { name: 'Test 2', maxScore: 100, isExam: false, order: 1 },
      { name: 'Final',  maxScore: 100, isExam: true,  order: 2 },
    ],
    caWeight: 40,
    boundaries: [
      { grade: 'A', min: 90, max: 100, remark: 'Excellent',  points: 4 },
      { grade: 'B', min: 80, max: 89,  remark: 'Good',       points: 3 },
      { grade: 'C', min: 70, max: 79,  remark: 'Average',    points: 2 },
      { grade: 'D', min: 60, max: 69,  remark: 'Below Avg',  points: 1 },
      { grade: 'F', min: 0,  max: 59,  remark: 'Fail',       points: 0 },
    ],
  },
  percentage: {
    label: 'Percentage Only (0–100)',
    components: [
      { name: 'CA',   maxScore: 100, isExam: false, order: 0 },
      { name: 'Exam', maxScore: 100, isExam: true,  order: 1 },
    ],
    caWeight: 30,
    boundaries: [
      { grade: 'Distinction', min: 75, max: 100, remark: 'Distinction', points: 1 },
      { grade: 'Merit',       min: 60, max: 74,  remark: 'Merit',       points: 2 },
      { grade: 'Pass',        min: 50, max: 59,  remark: 'Pass',        points: 3 },
      { grade: 'Fail',        min: 0,  max: 49,  remark: 'Fail',        points: 4 },
    ],
  },
};

const uid = () => Math.random().toString(36).slice(2, 8);

export default function GradingSettings() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const isAdmin = ['owner', 'org_admin'].includes(user?.orgRole);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [caWeight, setCaWeight] = useState(40);
  const [components, setComponents] = useState([]);
  const [boundaries, setBoundaries] = useState([]);
  const [presetKey, setPresetKey] = useState('');

  // ── Load current settings ──────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await API.get(`/org/${orgId}/grading-settings`);
      const s = res.data.gradingSettings || {};
      setCaWeight(s.caWeight ?? 40);
      setComponents(
        (s.scoreComponents || []).map(c => ({ ...c, _key: uid() }))
      );
      setBoundaries(
        (s.gradeBoundaries || []).map(b => ({ ...b, _key: uid() }))
      );
    } catch {
      showToast.error('Failed to load grading settings');
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // ── Pre-set picker ─────────────────────────────────────────────────────────
  function applyPreset(key) {
    if (!key || !PRESETS[key]) return;
    const p = PRESETS[key];
    setCaWeight(p.caWeight);
    setComponents(p.components.map(c => ({ ...c, _key: uid() })));
    setBoundaries(p.boundaries.map(b => ({ ...b, _key: uid() })));
    setPresetKey('');
    showToast.info(`Preset "${p.label}" applied — save to confirm`);
  }

  // ── Component helpers ──────────────────────────────────────────────────────
  function addComponent() {
    setComponents(prev => [...prev, { _key: uid(), name: '', maxScore: 100, isExam: false, order: prev.length }]);
  }
  function removeComponent(key) {
    setComponents(prev => prev.filter(c => c._key !== key).map((c, i) => ({ ...c, order: i })));
  }
  function updateComponent(key, field, value) {
    setComponents(prev => prev.map(c => c._key === key ? { ...c, [field]: value } : c));
  }

  // Auto-derive caWeight from components marked as exam
  const examCount = components.filter(c => c.isExam).length;
  const caCount = components.filter(c => !c.isExam).length;
  const derivedCaWeight = components.length > 0 && examCount > 0
    ? Math.round((caCount / components.length) * 100)
    : caWeight;

  // ── Boundary helpers ───────────────────────────────────────────────────────
  function addBoundary() {
    setBoundaries(prev => [...prev, { _key: uid(), grade: '', min: 0, max: 0, remark: '', points: 0 }]);
  }
  function removeBoundary(key) {
    setBoundaries(prev => prev.filter(b => b._key !== key));
  }
  function updateBoundary(key, field, value) {
    setBoundaries(prev => prev.map(b => b._key === key ? { ...b, [field]: value } : b));
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate() {
    if (components.length === 0) return 'Add at least one score component';
    for (const c of components) {
      if (!c.name.trim()) return 'All components must have a name';
      if (!c.maxScore || Number(c.maxScore) < 1) return `"${c.name}" must have a max score ≥ 1`;
    }
    if (boundaries.length === 0) return 'Add at least one grade boundary';
    for (const b of boundaries) {
      if (!b.grade) return 'All boundaries must have a grade label';
      if (Number(b.min) > Number(b.max)) return `Boundary "${b.grade}": min must be ≤ max`;
      if (!b.remark) return `Boundary "${b.grade}" must have a remark`;
    }
    return null;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    const err = validate();
    if (err) return showToast.error(err);

    setSaving(true);
    try {
      const effectiveCaWeight = components.length > 0 && examCount > 0 ? derivedCaWeight : caWeight;
      await API.put(`/org/${orgId}/grading-settings`, {
        caWeight: effectiveCaWeight,
        scoreComponents: components.map(({ _key, ...c }) => ({ ...c, maxScore: Number(c.maxScore) })),
        gradeBoundaries: boundaries.map(({ _key, ...b }) => ({
          ...b, min: Number(b.min), max: Number(b.max), points: Number(b.points) || 0,
        })),
      });
      showToast.success('Grading settings saved successfully');
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to save');
    }
    setSaving(false);
  }

  // ── Coverage check ─────────────────────────────────────────────────────────
  const coveredNums = new Set();
  boundaries.forEach(b => {
    for (let i = Number(b.min); i <= Number(b.max); i++) coveredNums.add(i);
  });
  const hasFullCoverage = coveredNums.has(0) && coveredNums.has(100);

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 700, margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
        <FiAlertCircle size={40} style={{ color: '#ef4444', marginBottom: 16 }} />
        <h2>Access Denied</h2>
        <p style={{ color: '#6b7280' }}>Only the Principal or Org Admin can configure grading settings.</p>
        <Link to="/org-admin" style={{ color: '#0a0a0a', fontWeight: 600 }}>← Back to dashboard</Link>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#6b7280' }}>Loading grading settings…</div>;
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1.5rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Link to="/org-admin" style={{ color: '#0a0a0a', lineHeight: 1 }}><FiArrowLeft size={18} /></Link>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Grading Settings</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '2px 0 0' }}>
            Configure your school's score components, CA/Exam weights, and grade boundaries.
            All changes apply org-wide instantly.
          </p>
        </div>
      </div>

      {/* Preset picker */}
      <div style={sectionCard}>
        <div style={sectionHeader}>
          <FiSliders size={15} style={{ color: '#6366f1' }} />
          <span>Quick Presets</span>
        </div>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          Load a standard grading template — you can customise it after applying.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <button key={key} onClick={() => applyPreset(key)} style={presetBtn}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Score Components */}
      <div style={sectionCard}>
        <div style={sectionHeader}>
          <FiAward size={15} style={{ color: '#0ea5e9' }} />
          <span>Score Components</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>
            {caCount} CA · {examCount} Exam
          </span>
        </div>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 14 }}>
          Define each assessed component. Mark ones that count as <strong>Exam weight</strong>.
          The rest contribute to the <strong>CA (Continuous Assessment)</strong> weight.
        </p>

        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {/* Header row */}
          <div style={compHeaderRow}>
            <span style={{ flex: 2 }}>Component Name</span>
            <span style={{ flex: 1, textAlign: 'center' }}>Max Score</span>
            <span style={{ flex: 1, textAlign: 'center' }}>Is Exam?</span>
            <span style={{ width: 32 }}></span>
          </div>
          {components.length === 0 && (
            <div style={{ color: '#94a3b8', fontSize: 13, padding: '8px 0' }}>
              No components yet. Click "+ Add Component" to start.
            </div>
          )}
          {components.map((c) => (
            <div key={c._key} style={compRow}>
              <input
                style={{ ...cellInput, flex: 2 }}
                value={c.name}
                onChange={e => updateComponent(c._key, 'name', e.target.value)}
                placeholder="e.g. CA1, Test 1, Practical"
              />
              <input
                type="number"
                min={1}
                max={500}
                style={{ ...cellInput, flex: 1, textAlign: 'center' }}
                value={c.maxScore}
                onChange={e => updateComponent(c._key, 'maxScore', e.target.value)}
              />
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!c.isExam}
                  onChange={e => updateComponent(c._key, 'isExam', e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#6366f1' }}
                />
                {c.isExam ? <span style={{ color: '#6366f1', fontWeight: 600 }}>Exam</span> : <span style={{ color: '#9ca3af' }}>CA</span>}
              </label>
              <button onClick={() => removeComponent(c._key)} style={iconBtn} title="Remove">
                <FiTrash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={addComponent} style={addBtn}>
          <FiPlus size={13} /> Add Component
        </button>

        {/* Weight display */}
        {components.length > 0 && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd', fontSize: 13 }}>
            <strong>Weight split: </strong>
            CA components ({caCount}) =&nbsp;
            <strong>{derivedCaWeight}%</strong> of final score &nbsp;·&nbsp;
            Exam components ({examCount}) =&nbsp;
            <strong>{100 - derivedCaWeight}%</strong> of final score
          </div>
        )}
      </div>

      {/* Grade Boundaries */}
      <div style={sectionCard}>
        <div style={{ ...sectionHeader, marginBottom: 4 }}>
          <FiAward size={15} style={{ color: '#f59e0b' }} />
          <span>Grade Boundaries</span>
          {!hasFullCoverage && boundaries.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
              <FiAlertCircle size={12} /> Gaps in 0–100 range
            </span>
          )}
          {hasFullCoverage && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
              <FiCheck size={12} /> Full coverage
            </span>
          )}
        </div>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 14 }}>
          Map final score ranges to letter grades, remarks, and grade points.
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Grade', 'Min (%)', 'Max (%)', 'Remark', 'Points', ''].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#6b7280', fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {boundaries.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '16px 10px', color: '#94a3b8' }}>No boundaries yet. Click "+ Add Boundary" to start.</td></tr>
              )}
              {boundaries.map((b) => (
                <tr key={b._key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <input style={cellInput} value={b.grade} onChange={e => updateBoundary(b._key, 'grade', e.target.value)} placeholder="A1" />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input type="number" min={0} max={100} style={{ ...cellInput, width: 64 }} value={b.min} onChange={e => updateBoundary(b._key, 'min', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input type="number" min={0} max={100} style={{ ...cellInput, width: 64 }} value={b.max} onChange={e => updateBoundary(b._key, 'max', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input style={cellInput} value={b.remark} onChange={e => updateBoundary(b._key, 'remark', e.target.value)} placeholder="Excellent" />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input type="number" min={0} style={{ ...cellInput, width: 56 }} value={b.points} onChange={e => updateBoundary(b._key, 'points', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <button onClick={() => removeBoundary(b._key)} style={iconBtn}><FiTrash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button onClick={addBoundary} style={{ ...addBtn, marginTop: 12 }}>
          <FiPlus size={13} /> Add Boundary
        </button>
      </div>

      {/* Preview */}
      {boundaries.length > 0 && (
        <div style={sectionCard}>
          <div style={sectionHeader}>
            <FiCheck size={15} style={{ color: '#22c55e' }} />
            <span>Preview — Sample Scores</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {[100, 90, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 20].map(score => {
              const b = boundaries.find(bnd => score >= Number(bnd.min) && score <= Number(bnd.max));
              return (
                <div key={score} style={{ textAlign: 'center', padding: '10px 14px', borderRadius: 8, background: b ? '#f0fdf4' : '#fef2f2', border: `1px solid ${b ? '#86efac' : '#fca5a5'}`, minWidth: 60 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: b ? '#15803d' : '#dc2626' }}>{score}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: b ? '#16a34a' : '#ef4444', marginTop: 2 }}>{b?.grade || '—'}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{b?.remark || 'no match'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Save bar */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #e5e7eb', marginTop: 4 }}>
        <button onClick={loadSettings} style={outlineBtn} disabled={saving}>
          <FiRefreshCw size={13} /> Reset
        </button>
        <button onClick={handleSave} style={saveBtn} disabled={saving}>
          {saving ? <><FiRefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><FiSave size={13} /> Save Changes</>}
        </button>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sectionCard = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '1.25rem 1.5rem',
  marginBottom: '1.25rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const sectionHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontWeight: 700,
  fontSize: 15,
  marginBottom: 10,
  color: '#0f172a',
};
const compHeaderRow = {
  display: 'flex',
  gap: 8,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 700,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const compRow = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid #f3f4f6',
};
const cellInput = {
  padding: '7px 10px',
  border: '1px solid #e5e7eb',
  borderRadius: 7,
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  background: '#fafafa',
  outline: 'none',
};
const iconBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#ef4444',
  padding: '4px',
  display: 'flex',
  alignItems: 'center',
  borderRadius: 4,
};
const addBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  background: '#f8fafc',
  border: '1px dashed #d1d5db',
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  cursor: 'pointer',
};
const presetBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  cursor: 'pointer',
  transition: 'all 0.15s',
};
const saveBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 24px',
  background: '#0f172a',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};
const outlineBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 18px',
  background: '#fff',
  color: '#374151',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
