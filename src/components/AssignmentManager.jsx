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

  // Grading modal state
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [gradeForm, setGradeForm] = useState({ score: '', feedback: '' });
  const [grading, setGrading] = useState(false);

  // Create / Edit form
  const [showForm, setShowForm] = useState(false);
  const [myAssignments, setMyAssignments] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', dueDate: '', maxScore: 100, questions: [] });
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

  function handleEditAssignment(a) {
    setEditingAssignmentId(a._id);
    setSelectedAssignment(null); // Not strictly needed for edit
    setForm({
      title: a.title,
      description: a.description || '',
      dueDate: a.dueDate ? new Date(a.dueDate).toISOString().slice(0, 16) : '',
      maxScore: a.maxScore,
      questions: a.questionIds || []
    });
    setShowForm(true);
  }

  async function handleDeleteAssignment(id) {
    if (!window.confirm("Are you sure you want to delete this draft assignment?")) return;
    try {
      const csrf = await API.get('/csrf-token');
      await API.delete(`/org/${orgId}/assignments/${id}`, { headers: { 'X-CSRF-Token': csrf.data.csrfToken } });
      toast.success('Assignment deleted');
      loadAssignments();
      if (expanded === id) setExpanded(null);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to delete assignment');
    }
  }

  async function handleSubmitForm(e) {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Title is required');
    if (!editingAssignmentId && !selectedAssignment) return toast.error('Select a class/subject first');
    
    setCreating(true);
    try {
      const csrf = await API.get('/csrf-token');
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        dueDate: form.dueDate || undefined,
        maxScore: Number(form.maxScore) || 100,
        questions: form.questions,
      };

      if (editingAssignmentId) {
        await API.patch(`/org/${orgId}/assignments/${editingAssignmentId}`, payload, { headers: { 'X-CSRF-Token': csrf.data.csrfToken } });
        toast.success('Assignment updated');
      } else {
        payload.classId = selectedAssignment.classId?._id || selectedAssignment.classId;
        payload.subjectId = selectedAssignment.subjectId?._id || selectedAssignment.subjectId;
        payload.termId = selectedAssignment.termId?._id || selectedAssignment.termId;
        await API.post(`/org/${orgId}/assignments`, payload, { headers: { 'X-CSRF-Token': csrf.data.csrfToken } });
        toast.success('Assignment created');
      }
      
      setForm({ title: '', description: '', dueDate: '', maxScore: 100, questions: [] });
      setShowForm(false);
      setEditingAssignmentId(null);
      loadAssignments();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to save assignment');
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

  function openGradeModal(s) {
    setSelectedSubmission(s);
    setGradeForm({ score: s.teacherScore || '', feedback: s.feedback || '' });
  }

  function closeGradeModal() {
    setSelectedSubmission(null);
  }

  async function handleGradeSubmission(e) {
    e.preventDefault();
    setGrading(true);
    try {
      const csrf = await API.get('/csrf-token');
      await API.patch(
        `/org/${orgId}/assignments/${expanded}/submissions/${selectedSubmission._id}/grade`,
        {
          teacherScore: Number(gradeForm.score),
          feedback: gradeForm.feedback,
        },
        { headers: { 'X-CSRF-Token': csrf.data.csrfToken } }
      );
      toast.success('Submission graded successfully');
      setSubmissions((prev) =>
        prev.map((s) =>
          s._id === selectedSubmission._id
            ? {
                ...s,
                teacherScore: Number(gradeForm.score),
                feedback: gradeForm.feedback,
                status: 'graded',
                totalScore: (s.autoScore || 0) + Number(gradeForm.score),
              }
            : s
        )
      );
      closeGradeModal();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to grade submission');
    } finally {
      setGrading(false);
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
          onClick={() => {
            if (showForm) {
              setEditingAssignmentId(null);
              setForm({ title: '', description: '', dueDate: '', maxScore: 100, questions: [] });
            }
            setShowForm(!showForm);
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: showForm ? '#f1f5f9' : '#0f172a', color: showForm ? '#334155' : '#fff', border: showForm ? '1px solid #e2e8f0' : 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          {showForm ? <><FiX size={14} /> Cancel</> : <><FiPlus size={14} /> New Assignment</>}
        </button>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <form onSubmit={handleSubmitForm} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24, marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #1e293b, #334155)' }} />
          <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiBook size={16} /> {editingAssignmentId ? 'Edit Assignment' : 'Create Assignment'}
          </h3>

          {!editingAssignmentId && myAssignments.length > 0 && (
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

          {/* Questions Builder */}
          <div style={{ marginBottom: 20, padding: '16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Questions (Optional)</h4>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, questions: [...f.questions, { questionType: 'multiple-choice', questionText: '', options: ['Option 1', 'Option 2'], correctAnswer: 0, explanation: '' }] }))}
                style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
              >
                <FiPlus size={12} /> Add Question
              </button>
            </div>
            
            {form.questions.map((q, i) => (
              <div key={i} style={{ padding: 12, border: '1px dashed #cbd5e1', borderRadius: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                  <select
                    value={q.questionType}
                    onChange={e => {
                      const newType = e.target.value;
                      const qs = [...form.questions];
                      qs[i] = { ...qs[i], questionType: newType };
                      if (newType === 'true-false') { qs[i].options = ['True', 'False']; qs[i].correctAnswer = 0; }
                      else if (newType === 'multiple-choice' && (!qs[i].options || qs[i].options.length < 2)) { qs[i].options = ['Option 1', 'Option 2']; qs[i].correctAnswer = 0; }
                      setForm({ ...form, questions: qs });
                    }}
                    style={{ ...inputStyle, width: '150px', padding: '6px' }}
                  >
                    <option value="multiple-choice">Multiple Choice</option>
                    <option value="true-false">True/False</option>
                    <option value="fill-in-blank">Fill in Blank</option>
                    <option value="essay">Essay / Theory</option>
                  </select>
                  
                  <input
                    placeholder="Question Text"
                    value={q.questionText || ''}
                    onChange={e => {
                      const qs = [...form.questions];
                      qs[i].questionText = e.target.value;
                      setForm({ ...form, questions: qs });
                    }}
                    style={{ ...inputStyle, flex: 1, padding: '6px' }}
                  />
                  
                  <button type="button" onClick={() => {
                    const qs = form.questions.filter((_, idx) => idx !== i);
                    setForm({ ...form, questions: qs });
                  }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} title="Remove Question">
                    <FiX size={16} />
                  </button>
                </div>
                
                {q.questionType === 'multiple-choice' && (
                  <div style={{ marginLeft: 160 }}>
                    {q.options?.map((opt, optIdx) => (
                      <div key={optIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <input
                          type="radio"
                          name={`q-${i}-correct-${optIdx}`}
                          checked={q.correctAnswer === optIdx}
                          onChange={() => {
                            const qs = [...form.questions];
                            qs[i].correctAnswer = optIdx;
                            setForm({ ...form, questions: qs });
                          }}
                        />
                        <input
                          value={opt}
                          onChange={e => {
                            const qs = [...form.questions];
                            qs[i].options[optIdx] = e.target.value;
                            setForm({ ...form, questions: qs });
                          }}
                          style={{ ...inputStyle, padding: '4px 8px', fontSize: 13, flex: 1 }}
                        />
                        {q.options.length > 2 && (
                          <button type="button" onClick={() => {
                            const qs = [...form.questions];
                            qs[i].options = qs[i].options.filter((_, oIdx) => oIdx !== optIdx);
                            if (qs[i].correctAnswer >= qs[i].options.length) qs[i].correctAnswer = 0;
                            setForm({ ...form, questions: qs });
                          }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}>
                            <FiX size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {q.options?.length < 5 && (
                      <button type="button" onClick={() => {
                        const qs = [...form.questions];
                        qs[i].options.push(`Option ${qs[i].options.length + 1}`);
                        setForm({ ...form, questions: qs });
                      }} style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, fontWeight: 600 }}>
                        + Add Option
                      </button>
                    )}
                  </div>
                )}
                
                {q.questionType === 'true-false' && (
                  <div style={{ marginLeft: 160, display: 'flex', gap: 16 }}>
                    {q.options?.map((opt, optIdx) => (
                      <label key={optIdx} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`q-${i}-correct-${optIdx}`}
                          checked={q.correctAnswer === optIdx}
                          onChange={() => {
                            const qs = [...form.questions];
                            qs[i].correctAnswer = optIdx;
                            setForm({ ...form, questions: qs });
                          }}
                        /> {opt}
                      </label>
                    ))}
                  </div>
                )}
                
                {q.questionType === 'fill-in-blank' && (
                  <div style={{ marginLeft: 160, marginTop: 4 }}>
                    <input
                      placeholder="Expected answer (e.g. Mitochondria)"
                      value={q.blankAnswer || ''}
                      onChange={e => {
                        const qs = [...form.questions];
                        qs[i].blankAnswer = e.target.value;
                        setForm({ ...form, questions: qs });
                      }}
                      style={{ ...inputStyle, padding: '4px 8px', fontSize: 13, width: '100%' }}
                    />
                  </div>
                )}
              </div>
            ))}
            {form.questions.length === 0 && <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>No questions added. A single generic text area will be created by default.</p>}
          </div>

          <button
            type="submit"
            disabled={creating}
            style={{ padding: '10px 24px', background: creating ? '#94a3b8' : '#0f172a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: creating ? 'not-allowed' : 'pointer' }}
          >
            {creating ? 'Saving…' : (editingAssignmentId ? 'Save Changes' : 'Create Assignment')}
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
                      <>
                        <button
                          onClick={() => handleEditAssignment(a)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteAssignment(a._id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => publishAssignment(a._id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          <FiSend size={12} /> Publish
                        </button>
                      </>
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
                            <th style={{ padding: '6px 8px', fontWeight: 600, color: '#6b7280', textAlign: 'right' }}>Actions</th>
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
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                <button
                                  onClick={() => openGradeModal(s)}
                                  style={{
                                    padding: '4px 10px',
                                    background: '#0f172a',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {s.status === 'graded' ? 'Edit Grade' : 'Review & Grade'}
                                </button>
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

      {/* Grade Modal */}
      {selectedSubmission && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
        }}>
          <div style={{
            background: '#fff', width: '100%', maxWidth: 640, borderRadius: 16,
            maxHeight: '90vh', overflowY: 'auto', position: 'relative'
          }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Grade Submission</h3>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                  Student: {selectedSubmission.studentId?.fullname || selectedSubmission.studentId?.username || selectedSubmission.studentId?.email}
                </div>
              </div>
              <button onClick={closeGradeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
                <FiX size={20} />
              </button>
            </div>

            <div style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={labelStyle}>Student's Answer</label>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  {selectedSubmission.answers && selectedSubmission.answers.length > 0 ? (
                    selectedSubmission.answers.map((ans, idx) => {
                      const text = ans.answer || '';
                      // Simple check to render images if answer happens to be a URL to an image
                      const isImage = text.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i) || text.startsWith('data:image/');
                      return (
                        <div key={idx} style={{ marginBottom: 12 }}>
                          {isImage ? (
                            <img src={text} alt="Submission" style={{ maxWidth: '100%', borderRadius: 8 }} />
                          ) : (
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: '#334155', wordBreak: 'break-word' }}>
                              {text}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No answers provided.</span>
                  )}
                </div>
              </div>

              <form onSubmit={handleGradeSubmission}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: '1.5rem' }}>
                  <div>
                    <label style={labelStyle}>Teacher Score</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      required
                      value={gradeForm.score}
                      onChange={e => setGradeForm(f => ({ ...f, score: e.target.value }))}
                      style={inputStyle}
                      placeholder="Enter score"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Auto Score (Readonly)</label>
                    <input
                      type="number"
                      value={selectedSubmission.autoScore || 0}
                      disabled
                      style={{ ...inputStyle, background: '#f1f5f9', color: '#64748b' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={labelStyle}>Feedback (Optional)</label>
                  <textarea
                    rows={4}
                    value={gradeForm.feedback}
                    onChange={e => setGradeForm(f => ({ ...f, feedback: e.target.value }))}
                    style={{ ...inputStyle, resize: 'vertical' }}
                    placeholder="Provide feedback on the answer..."
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button type="button" onClick={closeGradeModal} style={{ padding: '10px 16px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={grading} style={{ padding: '10px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: grading ? 'not-allowed' : 'pointer' }}>
                    {grading ? 'Saving...' : 'Save Grade'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: '#fff' };

export default AssignmentManager;


