import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { FiPlus, FiCheck, FiPlay, FiLock, FiChevronDown, FiChevronRight, FiArrowLeft, FiEdit2, FiSave, FiX } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { showToast } from '../utils/toast';

/* ── helpers ── */
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** Given a year's start/end dates, return the 3 auto-split term date ranges (same logic as backend) */
function autoSplit(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start) || isNaN(end) || end <= start) return null;

  const totalMs = end.getTime() - start.getTime();
  const thirdMs = Math.floor(totalMs / 3);
  const gapMs = 24 * 60 * 60 * 1000;

  const toVal = (d) => d.toISOString().slice(0, 10);
  return [
    { startDate: toVal(new Date(start)), endDate: toVal(new Date(start.getTime() + thirdMs)) },
    { startDate: toVal(new Date(start.getTime() + thirdMs + gapMs)), endDate: toVal(new Date(start.getTime() + 2 * thirdMs + gapMs)) },
    { startDate: toVal(new Date(start.getTime() + 2 * thirdMs + 2 * gapMs)), endDate: toVal(new Date(end)) },
  ];
}

const TERM_NAMES = ['First Term', 'Second Term', 'Third Term'];
const emptyTermDates = () => TERM_NAMES.map(() => ({ startDate: '', endDate: '' }));

/* ── component ── */
function AcademicCalendar() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const canManage = ['owner', 'org_admin'].includes(user?.orgRole);

  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedYear, setExpandedYear] = useState(null);

  /* create-year form */
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [termDates, setTermDates] = useState(emptyTermDates());
  const [submitting, setSubmitting] = useState(false);

  /* per-term inline edit */
  const [editingTerm, setEditingTerm] = useState(null); // termId
  const [editDates, setEditDates] = useState({ startDate: '', endDate: '' });
  const [savingTerm, setSavingTerm] = useState(false);

  const fetchYears = async () => {
    if (!orgId) return;
    try {
      const res = await API.get(`/org/${orgId}/academic-years`);
      const list = res.data.academicYears || [];
      setYears(list);
      const active = list.find(y => y.isActive);
      if (active) setExpandedYear(active._id);
      else if (list.length > 0) setExpandedYear(list[0]._id);
    } catch { /* keep empty */ }
    setLoading(false);
  };

  useEffect(() => { fetchYears(); }, [orgId]);

  /* ── When year dates change, pre-fill per-term fields with auto-split hint ── */
  const preview = autoSplit(form.startDate, form.endDate);

  const handleYearDateChange = (field, val) => {
    const next = { ...form, [field]: val };
    setForm(next);
    // Only pre-fill term dates if the user hasn't manually touched them yet
    const splits = autoSplit(next.startDate, next.endDate);
    if (splits) {
      setTermDates(splits.map(s => ({ startDate: s.startDate, endDate: s.endDate })));
    }
  };

  const updateTermDate = (idx, field, val) => {
    setTermDates(prev => prev.map((t, i) => i === idx ? { ...t, [field]: val } : t));
  };

  const createYear = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.startDate || !form.endDate) return showToast.warning('Fill all fields');
    // Validate that all term dates are filled
    for (let i = 0; i < 3; i++) {
      if (!termDates[i].startDate || !termDates[i].endDate) {
        return showToast.warning(`Set start and end dates for ${TERM_NAMES[i]}`);
      }
    }
    setSubmitting(true);
    try {
      await API.post(`/org/${orgId}/academic-years`, { ...form, terms: termDates });
      showToast.success('Academic year created');
      setForm({ name: '', startDate: '', endDate: '' });
      setTermDates(emptyTermDates());
      setShowCreateForm(false);
      fetchYears();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to create');
    }
    setSubmitting(false);
  };

  const activateYear = async (yearId) => {
    try {
      await API.post(`/org/${orgId}/academic-years/${yearId}/activate`);
      showToast.success('Academic year activated');
      fetchYears();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to activate');
    }
  };

  const openTerm = async (termId) => {
    try {
      await API.post(`/org/${orgId}/terms/${termId}/open`);
      showToast.success('Term opened');
      fetchYears();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to open term');
    }
  };

  const closeTerm = async (termId) => {
    try {
      await API.post(`/org/${orgId}/terms/${termId}/close`, { force: true, reason: 'Admin close' });
      showToast.success('Term closed');
      fetchYears();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to close term');
    }
  };

  const startEditTerm = (term) => {
    setEditingTerm(term._id);
    setEditDates({
      startDate: term.startDate ? new Date(term.startDate).toISOString().slice(0, 10) : '',
      endDate: term.endDate ? new Date(term.endDate).toISOString().slice(0, 10) : '',
    });
  };

  const saveTermDates = async (termId) => {
    if (!editDates.startDate || !editDates.endDate) return showToast.warning('Both dates required');
    setSavingTerm(true);
    try {
      await API.patch(`/org/${orgId}/terms/${termId}`, editDates);
      showToast.success('Term dates updated');
      setEditingTerm(null);
      fetchYears();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to update dates');
    }
    setSavingTerm(false);
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Link to="/org-admin" style={{ color: '#0a0a0a' }}><FiArrowLeft size={18} /></Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Academic Calendar</h1>
      </div>
      <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: 14 }}>
        Manage academic years and terms. Activate a year, then open terms to begin the school calendar.
      </p>

      {/* Create form */}
      {canManage && (
        <div style={{ marginBottom: '2rem' }}>
          {!showCreateForm ? (
            <button onClick={() => setShowCreateForm(true)} style={btnPrimary}>
              <FiPlus size={14} /> New Academic Year
            </button>
          ) : (
            <form onSubmit={createYear} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
              {/* Year-level fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div>
                  <label style={labelStyle}>Year Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. 2025/2026"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Session Start Date *</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => handleYearDateChange('startDate', e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Session End Date *</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => handleYearDateChange('endDate', e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Per-term date fields */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginBottom: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
                  Term Dates
                  {preview && (
                    <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 8 }}>
                      (pre-filled from auto-split — adjust as needed)
                    </span>
                  )}
                </p>
                {TERM_NAMES.map((name, i) => (
                  <div key={name} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 12, alignItems: 'end', marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', paddingBottom: 10 }}>{name}</div>
                    <div>
                      <label style={labelStyle}>Start *</label>
                      <input
                        type="date"
                        value={termDates[i].startDate}
                        onChange={e => updateTermDate(i, 'startDate', e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>End *</label>
                      <input
                        type="date"
                        value={termDates[i].endDate}
                        onChange={e => updateTermDate(i, 'endDate', e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" disabled={submitting} style={btnPrimary}>{submitting ? 'Creating…' : 'Create Year'}</button>
                <button type="button" onClick={() => { setShowCreateForm(false); setTermDates(emptyTermDates()); }} style={btnOutline}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Years list */}
      {loading ? (
        <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading…</p>
      ) : years.length === 0 ? (
        <div style={{ background: '#f9fafb', borderRadius: 10, padding: 40, textAlign: 'center', color: '#6b7280' }}>
          No academic years created yet. Click "New Academic Year" to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {years.map(year => {
            const isExpanded = expandedYear === year._id;
            const terms = year.terms || [];
            return (
              <div key={year._id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                {/* Year header */}
                <div
                  onClick={() => setExpandedYear(isExpanded ? null : year._id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', background: year.isActive ? '#f9fafb' : '#fff' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isExpanded ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                    <span style={{ fontWeight: 600 }}>{year.name}</span>
                    {year.isActive && <span style={badgeActive}>Active</span>}
                    {year.isArchived && <span style={badgeArchived}>Archived</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: '#6b7280' }}>{fmtDate(year.startDate)} — {fmtDate(year.endDate)}</span>
                    {canManage && !year.isActive && !year.isArchived && (
                      <button onClick={e => { e.stopPropagation(); activateYear(year._id); }} style={{ ...btnSmall, background: '#0a0a0a', color: '#fff' }}>
                        <FiCheck size={12} /> Activate
                      </button>
                    )}
                  </div>
                </div>

                {/* Terms */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #e5e7eb', padding: '12px 20px' }}>
                    {terms.length === 0 ? (
                      <p style={{ color: '#6b7280', fontSize: 14 }}>No terms found.</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th style={thStyle}>Term</th>
                            <th style={thStyle}>Start</th>
                            <th style={thStyle}>End</th>
                            <th style={thStyle}>Status</th>
                            {canManage && <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {terms.map(term => {
                            const isEditing = editingTerm === term._id;
                            return (
                              <tr key={term._id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={tdStyle}>{term.name}</td>

                                {/* Date cells — inline edit when editing */}
                                {isEditing ? (
                                  <>
                                    <td style={tdStyle}>
                                      <input
                                        type="date"
                                        value={editDates.startDate}
                                        onChange={e => setEditDates(d => ({ ...d, startDate: e.target.value }))}
                                        style={{ ...inputStyle, padding: '5px 8px', fontSize: 13, width: 140 }}
                                      />
                                    </td>
                                    <td style={tdStyle}>
                                      <input
                                        type="date"
                                        value={editDates.endDate}
                                        onChange={e => setEditDates(d => ({ ...d, endDate: e.target.value }))}
                                        style={{ ...inputStyle, padding: '5px 8px', fontSize: 13, width: 140 }}
                                      />
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td style={tdStyle}>{fmtDate(term.startDate)}</td>
                                    <td style={tdStyle}>{fmtDate(term.endDate)}</td>
                                  </>
                                )}

                                <td style={tdStyle}>
                                  {term.isActive ? <span style={badgeActive}>Active</span>
                                    : term.isClosed ? <span style={badgeArchived}>Closed</span>
                                    : <span style={badgeDefault}>Pending</span>}
                                </td>

                                {canManage && (
                                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                                    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                      {/* Date edit controls — only for non-closed terms */}
                                      {!term.isClosed && (
                                        isEditing ? (
                                          <>
                                            <button
                                              onClick={() => saveTermDates(term._id)}
                                              disabled={savingTerm}
                                              style={{ ...btnSmall, background: '#0a0a0a', color: '#fff' }}
                                            >
                                              <FiSave size={11} /> {savingTerm ? '…' : 'Save'}
                                            </button>
                                            <button
                                              onClick={() => setEditingTerm(null)}
                                              style={btnSmall}
                                            >
                                              <FiX size={11} /> Cancel
                                            </button>
                                          </>
                                        ) : (
                                          <button
                                            onClick={() => startEditTerm(term)}
                                            style={btnSmall}
                                            title="Edit term dates"
                                          >
                                            <FiEdit2 size={11} /> Dates
                                          </button>
                                        )
                                      )}

                                      {/* Open / Close controls */}
                                      {!isEditing && !term.isClosed && !term.isActive && year.isActive && (
                                        <button onClick={() => openTerm(term._id)} style={btnSmall}>
                                          <FiPlay size={11} /> Open
                                        </button>
                                      )}
                                      {!isEditing && term.isActive && (
                                        <button onClick={() => closeTerm(term._id)} style={{ ...btnSmall, background: '#0a0a0a', color: '#fff' }}>
                                          <FiLock size={11} /> Close
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const btnOutline = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: '#fff', color: '#0a0a0a', border: '1px solid #e5e7eb', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const btnSmall = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#fff', color: '#0a0a0a', border: '1px solid #e5e7eb', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' };
const labelStyle = { fontSize: 13, fontWeight: 600, color: '#333', display: 'block', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#6b7280' };
const tdStyle = { padding: '10px 12px' };
const badgeActive = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#0a0a0a', color: '#fff' };
const badgeArchived = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#e5e7eb', color: '#6b7280' };
const badgeDefault = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: '#9ca3af' };

export default AcademicCalendar;
