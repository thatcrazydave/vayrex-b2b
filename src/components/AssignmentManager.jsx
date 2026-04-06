import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { FiPlus, FiSend, FiList, FiChevronDown, FiChevronUp, FiX, FiBook } from 'react-icons/fi';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext.jsx';

function AssignmentManager() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [subLoading, setSubLoading] = useState(false);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [myAssignments, setMyAssignments] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', dueDate: '', maxScore: 100 });
  const [creating, setCreating] = useState(false);

  const loadAssignments = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await API.get(`/org/${orgId}/assignments`);
      setAssignments(res.data.assignments || []);
    } catch { /* keep empty */ }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  // Load teacher's subject assignments for the create form
  useEffect(() => {
    if (!orgId || !showForm) return;
    API.get(`/org/${orgId}/subjects/my-assignments`)
      .then(res => {
        const list = res.data.assignments || [];
        setMyAssignments(list);
        if (list.length > 0 && !selectedAssignment) setSelectedAssignment(list[0]);
      })
      .catch(() => {});
  }, [orgId, showForm]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Title is required');
    if (!selectedAssignment) return toast.error('Select a class/subject first');
    setCreating(true);
    try {
      const csrf = await API.get('/csrf-token');
      await API.post(`/org/${orgId}/assignments`, {
        classId: selectedAssignment.classId?._id || selectedAssignment.classId,
        subjectId: selectedAssignment.subjectId?._id || selectedAssignment.subjectId,
        termId: selectedAssignment.termId?._id || selectedAssignment.termId,
        title: form.title.trim(),
        description: form.description.trim(),
        dueDate: form.dueDate || undefined,
        maxScore: Number(form.maxScore) || 100,
      }, { headers: { 'X-CSRF-Token': csrf.data.csrfToken } });
      toast.success('Assignment created');
      setForm({ title: '', description: '', dueDate: '', maxScore: 100 });
      setShowForm(false);
      loadAssignments();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to create assignment');
    } finally {
      setCreating(false);
    }
  }

  async function publishAssignment(id) {
    try {
      const csrf = await API.get('/csrf-token');
      await API.post(`/org/${orgId}/assignments/${id}/publish`, {}, { headers: { 'X-CSRF-Token': csrf.data.csrfToken } });
      toast.success('Assignment published');
      loadAssignments();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to publish');
    }
  }

  async function toggleSubmissions(id) {
    if (expanded === id) {
      setExpanded(null);
      setSubmissions([]);
      return;
    }
    setExpanded(id);
    setSubLoading(true);
    try {
      const res = await API.get(`/org/${orgId}/assignments/${id}/submissions`);
      setSubmissions(res.data.submissions || []);
    } catch { setSubmissions([]); }
    setSubLoading(false);
  }

  const statusColors = {
    draft:     { bg: '#fef3c7', color: '#92400e' },
    assigned:  { bg: '#dbeafe', color: '#1e40af' },
    submitted: { bg: '#e0e7ff', color: '#3730a3' },
    marked:    { bg: '#f1f5f9', color: '#475569' },
    published: { bg: '#e0f2fe', color: '#0369a1' },
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Assignments</h1>
          <p style={{ fontSize: '0.9rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>Create and manage assignments for your classes.</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: showForm ? '#f1f5f9' : '#0f172a', color: showForm ? '#334155' : '#fff', border: showForm ? '1px solid #e2e8f0' : 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          {showForm ? <><FiX size={14} /> Cancel</> : <><FiPlus size={14} /> New Assignment</>}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleCreate} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24, marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #1e293b, #334155)' }} />
          <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiBook size={16} /> Create Assignment
          </h3>

          {myAssignments.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Class / Subject</label>
              <select
                value={selectedAssignment?._id || ''}
                onChange={e => setSelectedAssignment(myAssignments.find(a => a._id === e.target.value))}
                style={inputStyle}
              >
                {myAssignments.map(a => (
                  <option key={a._id} value={a._id}>
                    {a.classId?.name || 'Class'} — {a.subjectId?.name || 'Subject'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Title *</label>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Assignment title"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Instructions for students..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}>Due Date</label>
              <input type="datetime-local" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Max Score</label>
              <input type="number" min={1} value={form.maxScore} onChange={e => setForm(f => ({ ...f, maxScore: e.target.value }))} style={inputStyle} />
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            style={{ padding: '10px 24px', background: creating ? '#94a3b8' : '#0f172a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: creating ? 'not-allowed' : 'pointer' }}
          >
            {creating ? 'Creating…' : 'Create Assignment'}
          </button>
        </form>
      )}

      {/* Assignment list */}
      {loading ? (
        <p style={{ textAlign: 'center', color: '#999', padding: 40 }}>Loading…</p>
      ) : assignments.length === 0 ? (
        <div style={{ background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 12, padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
          <FiBook size={32} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <p style={{ margin: 0 }}>No assignments yet. Create your first one above.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {assignments.map(a => {
            const sc = statusColors[a.status] || { bg: '#f3f4f6', color: '#374151' };
            return (
              <div key={a._id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{a.title}</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                      {a.classId?.name || ''} · {a.subjectId?.name || ''} · Due: {a.dueDate ? new Date(a.dueDate).toLocaleDateString() : 'No deadline'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: sc.bg, color: sc.color }}>
                      {a.status}
                    </span>
                    {a.status === 'draft' && (
                      <button
                        onClick={() => publishAssignment(a._id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        <FiSend size={12} /> Publish
                      </button>
                    )}
                    {a.status !== 'draft' && (
                      <button
                        onClick={() => toggleSubmissions(a._id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        <FiList size={12} /> Submissions {expanded === a._id ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Submissions panel */}
                {expanded === a._id && (
                  <div style={{ borderTop: '1px solid #e5e7eb', padding: '1rem 1.25rem', background: '#f8fafc' }}>
                    {subLoading ? (
                      <p style={{ color: '#999', fontSize: 13 }}>Loading submissions…</p>
                    ) : submissions.length === 0 ? (
                      <p style={{ color: '#94a3b8', fontSize: 13 }}>No submissions yet.</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                            <th style={{ padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Student</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Submitted</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Auto Score</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Total</th>
                            <th style={{ padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {submissions.map(s => (
                            <tr key={s._id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '8px' }}>{s.studentId?.fullname || s.studentId?.username || s.studentId?.email || '—'}</td>
                              <td style={{ padding: '8px', color: '#6b7280' }}>{s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '—'}</td>
                              <td style={{ padding: '8px' }}>{s.autoScore ?? '—'}</td>
                              <td style={{ padding: '8px', fontWeight: 600 }}>{s.totalScore ?? '—'}</td>
                              <td style={{ padding: '8px' }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                  background: s.status === 'graded' ? '#e0f2fe' : '#fef3c7',
                                  color: s.status === 'graded' ? '#0369a1' : '#92400e',
                                }}>
                                  {s.status || 'submitted'}
                                </span>
                              </td>
                            </tr>
                          ))}
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

const labelStyle = { fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: '#fff' };

export default AssignmentManager;


