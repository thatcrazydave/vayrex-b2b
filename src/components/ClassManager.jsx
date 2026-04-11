import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { FiPlus, FiUsers, FiEdit2, FiX, FiArrowLeft, FiBook, FiUser } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { showToast } from '../utils/toast';

function ClassManager() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const canManage = ['owner', 'org_admin'].includes(user?.orgRole);

  const [tab, setTab] = useState('classes'); // classes | subjects | assignments
  const [classrooms, setClassrooms] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [years, setYears] = useState([]);
  const [terms, setTerms] = useState([]);
  const [selectedYearId, setSelectedYearId] = useState('');
  const [loading, setLoading] = useState(true);

  // Forms
  const [showClassForm, setShowClassForm] = useState(false);
  const [classForm, setClassForm] = useState({ name: '', level: '', capacity: '' });
  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '', description: '' });
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignForm, setAssignForm] = useState({ teacherId: '', subjectId: '', classId: '', termId: '' });
  const [showEnrollModal, setShowEnrollModal] = useState(null); // classId
  const [enrollIds, setEnrollIds] = useState([]);
  const [enrollReason, setEnrollReason] = useState('');
  const [editingClass, setEditingClass] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = async () => {
    if (!orgId) return;
    try {
      const [cRes, sRes, aRes, mRes, yRes] = await Promise.allSettled([
        API.get(`/org/${orgId}/classrooms`),
        API.get(`/org/${orgId}/subjects`),
        API.get(`/org/${orgId}/subjects/assignments`),
        API.get(`/org/${orgId}/members?limit=200`),
        API.get(`/org/${orgId}/academic-years`),
      ]);
      if (cRes.status === 'fulfilled') setClassrooms(cRes.value.data.classrooms || []);
      if (sRes.status === 'fulfilled') setSubjects(sRes.value.data.subjects || []);
      if (aRes.status === 'fulfilled') setAssignments(aRes.value.data.assignments || []);
      if (mRes.status === 'fulfilled') {
        const members = mRes.value.data.members || [];
        // isActive is the correct field (not status) — filter out deactivated members
        setTeachers(members.filter(m => m.orgRole === 'teacher' && m.isActive !== false));
        setStudents(members.filter(m => m.orgRole === 'student' && m.isActive !== false));
      }
      if (yRes.status === 'fulfilled') {
        const allYears = yRes.value.data.academicYears || [];
        setYears(allYears);
        const activeYear = allYears.find(y => y.isActive) || allYears[0];
        if (activeYear) {
          setSelectedYearId(prev => prev || activeYear._id);
          setTerms(activeYear.terms || []);
        }
      }
    } catch { /* keep empty */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [orgId]);

  // --- Classrooms ---
  const createClass = async (e) => {
    e.preventDefault();
    if (!classForm.name.trim()) return showToast.warning('Class name is required');
    setSubmitting(true);
    try {
      await API.post(`/org/${orgId}/classrooms`, {
        name: classForm.name.trim(),
        level: classForm.level.trim() || undefined,
        capacity: classForm.capacity ? Number(classForm.capacity) : undefined,
        academicYearId: selectedYearId || undefined,
      });
      showToast.success('Class created');
      setClassForm({ name: '', level: '', capacity: '' });
      setShowClassForm(false);
      fetchAll();
    } catch (err) { showToast.error(err.response?.data?.error?.message || 'Failed'); }
    setSubmitting(false);
  };

  const saveClassEdit = async (classId) => {
    setSubmitting(true);
    try {
      await API.patch(`/org/${orgId}/classrooms/${classId}`, {
        name: editForm.name || undefined,
        classTeacherId: editForm.classTeacherId || undefined,
        capacity: editForm.capacity ? Number(editForm.capacity) : undefined,
        level: editForm.level || undefined,
      });
      showToast.success('Class updated');
      setEditingClass(null);
      fetchAll();
    } catch (err) { showToast.error(err.response?.data?.error?.message || 'Failed'); }
    setSubmitting(false);
  };

  const enrollStudents = async () => {
    if (enrollIds.length === 0) return showToast.warning('Select students');
    setSubmitting(true);
    try {
      const res = await API.post(`/org/${orgId}/classrooms/${showEnrollModal}/enroll`, { studentIds: enrollIds, reason: enrollReason });
      showToast.success(res?.data?.message || 'Students enrolled');
      setShowEnrollModal(null);
      setEnrollIds([]);
      setEnrollReason('');
      fetchAll();
    } catch (err) { showToast.error(err.response?.data?.error?.message || 'Failed'); }
    setSubmitting(false);
  };

  // --- Subjects ---
  const createSubject = async (e) => {
    e.preventDefault();
    if (!subjectForm.name.trim()) return showToast.warning('Subject name is required');
    setSubmitting(true);
    try {
      await API.post(`/org/${orgId}/subjects`, {
        name: subjectForm.name.trim(),
        code: subjectForm.code.trim() || undefined,
        description: subjectForm.description.trim() || undefined,
      });
      showToast.success('Subject created');
      setSubjectForm({ name: '', code: '', description: '' });
      setShowSubjectForm(false);
      fetchAll();
    } catch (err) { showToast.error(err.response?.data?.error?.message || 'Failed'); }
    setSubmitting(false);
  };

  // --- Assignments ---
  const assignTeacher = async (e) => {
    e.preventDefault();
    const { teacherId, subjectId, classId, termId } = assignForm;
    if (!teacherId || !subjectId || !classId || !termId) return showToast.warning('All fields required');
    setSubmitting(true);
    try {
      await API.post(`/org/${orgId}/subjects/assign`, assignForm);
      showToast.success('Teacher assigned');
      setAssignForm({ teacherId: '', subjectId: '', classId: '', termId: '' });
      setShowAssignForm(false);
      fetchAll();
    } catch (err) { showToast.error(err.response?.data?.error?.message || 'Failed'); }
    setSubmitting(false);
  };

  const removeAssignment = async (id) => {
    try {
      await API.delete(`/org/${orgId}/subjects/assignments/${id}`);
      showToast.success('Assignment removed');
      fetchAll();
    } catch (err) { showToast.error(err.response?.data?.error?.message || 'Failed'); }
  };

  const getTeacherName = (id) => { const t = teachers.find(t => t._id === id); return t ? (t.fullname || t.email) : '—'; };
  const getSubjectName = (id) => { const s = subjects.find(s => s._id === id); return s ? s.name : '—'; };
  const getClassName = (id) => { const c = classrooms.find(c => c._id === id); return c ? c.name : '—'; };
  const getTermName = (id) => { const t = terms.find(t => t._id === id); return t ? t.name : '—'; };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Link to="/org-admin" style={{ color: '#0a0a0a' }}><FiArrowLeft size={18} /></Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Classes & Subjects</h1>
      </div>
      <p style={{ color: '#6b7280', marginBottom: '1.5rem', fontSize: 14 }}>
        Create classes, add subjects, assign teachers, and enroll students.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        {[['classes', 'Classes'], ['subjects', 'Subjects'], ['assignments', 'Teacher Assignments']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '10px 20px', border: 'none', background: 'none', fontWeight: tab === key ? 700 : 400,
            borderBottom: tab === key ? '2px solid #0a0a0a' : '2px solid transparent', cursor: 'pointer', fontSize: 14
          }}>{label}</button>
        ))}
      </div>

      {/* ====== CLASSES TAB ====== */}
      {tab === 'classes' && (
        <>
          {canManage && !showClassForm && (
            <button onClick={() => setShowClassForm(true)} style={btnPrimary}><FiPlus size={14} /> New Class</button>
          )}
          {showClassForm && (
            <form onSubmit={createClass} style={formBox}>
              <div style={gridThree}>
                <div>
                  <label style={labelStyle}>Class Name *</label>
                  <input value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} placeholder="e.g. JSS 1A" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Level</label>
                  <input value={classForm.level} onChange={e => setClassForm({ ...classForm, level: e.target.value })} placeholder="e.g. JSS 1" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Capacity</label>
                  <input type="number" value={classForm.capacity} onChange={e => setClassForm({ ...classForm, capacity: e.target.value })} placeholder="e.g. 40" style={inputStyle} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Academic Year *</label>
                <select
                  value={selectedYearId}
                  onChange={e => setSelectedYearId(e.target.value)}
                  style={inputStyle}
                  required
                >
                  <option value="">Select academic year…</option>
                  {years.map(y => (
                    <option key={y._id} value={y._id}>
                      {y.name}{y.isActive ? ' (Active)' : ''}
                    </option>
                  ))}
                </select>
                {years.length === 0 && (
                  <p style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>No academic years found. Create one under Academic Calendar first.</p>
                )}
              </div>
              <div style={btnRow}>
                <button type="submit" disabled={submitting} style={btnPrimary}>{submitting ? 'Creating…' : 'Create Class'}</button>
                <button type="button" onClick={() => setShowClassForm(false)} style={btnOutline}>Cancel</button>
              </div>
            </form>
          )}
          <div style={{ marginTop: 16 }}>
            {classrooms.length === 0 ? (
              <div style={emptyState}>No classes yet. Create one to get started.</div>
            ) : (
              <table style={tableStyle}>
                <thead><tr style={trHead}>
                  <th style={thStyle}>Class</th>
                  <th style={thStyle}>Level</th>
                  <th style={thStyle}>Teacher</th>
                  <th style={thStyle}>Students</th>
                  <th style={thStyle}>Capacity</th>
                  {canManage && <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>}
                </tr></thead>
                <tbody>
                  {classrooms.map(c => (
                    <tr key={c._id} style={trBody}>
                      {editingClass === c._id ? (
                        <>
                          <td style={tdStyle}><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} style={{ ...inputStyle, padding: '6px 8px', width: 120 }} /></td>
                          <td style={tdStyle}><input value={editForm.level} onChange={e => setEditForm({ ...editForm, level: e.target.value })} style={{ ...inputStyle, padding: '6px 8px', width: 80 }} /></td>
                          <td style={tdStyle}>
                            <select value={editForm.classTeacherId} onChange={e => setEditForm({ ...editForm, classTeacherId: e.target.value })} style={{ ...inputStyle, padding: '6px 8px', width: 160 }}>
                              <option value="">None</option>
                              {teachers.map(t => <option key={t._id} value={t._id}>{t.fullname || t.email}</option>)}
                            </select>
                          </td>
                          <td style={tdStyle}>{c.studentIds?.length || 0}</td>
                          <td style={tdStyle}><input type="number" value={editForm.capacity} onChange={e => setEditForm({ ...editForm, capacity: e.target.value })} style={{ ...inputStyle, padding: '6px 8px', width: 60 }} /></td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            <button onClick={() => saveClassEdit(c._id)} disabled={submitting} style={{ ...btnSmall, background: '#0a0a0a', color: '#fff' }}>Save</button>
                            <button onClick={() => setEditingClass(null)} style={btnSmall}>Cancel</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{c.name}</td>
                          <td style={tdStyle}>{c.level || '—'}</td>
                          <td style={tdStyle}>{c.classTeacherId?.fullname || c.classTeacherId?.email || '—'}</td>
                          <td style={tdStyle}>{c.studentIds?.length || 0}</td>
                          <td style={tdStyle}>{c.capacity || '—'}</td>
                          {canManage && (
                            <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button onClick={() => { setEditingClass(c._id); setEditForm({ name: c.name, level: c.level || '', classTeacherId: typeof c.classTeacherId === 'object' ? c.classTeacherId?._id : c.classTeacherId || '', capacity: c.capacity || '' }); }} style={btnSmall}><FiEdit2 size={11} /> Edit</button>
                              <button onClick={() => setShowEnrollModal(c._id)} style={{ ...btnSmall, marginLeft: 4 }}><FiUsers size={11} /> Enroll</button>
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ====== SUBJECTS TAB ====== */}
      {tab === 'subjects' && (
        <>
          {canManage && !showSubjectForm && (
            <button onClick={() => setShowSubjectForm(true)} style={btnPrimary}><FiPlus size={14} /> New Subject</button>
          )}
          {showSubjectForm && (
            <form onSubmit={createSubject} style={formBox}>
              <div style={gridThree}>
                <div>
                  <label style={labelStyle}>Subject Name *</label>
                  <input value={subjectForm.name} onChange={e => setSubjectForm({ ...subjectForm, name: e.target.value })} placeholder="e.g. Mathematics" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Code</label>
                  <input value={subjectForm.code} onChange={e => setSubjectForm({ ...subjectForm, code: e.target.value })} placeholder="e.g. MATH" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <input value={subjectForm.description} onChange={e => setSubjectForm({ ...subjectForm, description: e.target.value })} placeholder="Optional description" style={inputStyle} />
                </div>
              </div>
              <div style={btnRow}>
                <button type="submit" disabled={submitting} style={btnPrimary}>{submitting ? 'Creating…' : 'Create Subject'}</button>
                <button type="button" onClick={() => setShowSubjectForm(false)} style={btnOutline}>Cancel</button>
              </div>
            </form>
          )}
          <div style={{ marginTop: 16 }}>
            {subjects.length === 0 ? (
              <div style={emptyState}>No subjects yet. Create one to get started.</div>
            ) : (
              <table style={tableStyle}>
                <thead><tr style={trHead}>
                  <th style={thStyle}>Subject</th>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Description</th>
                </tr></thead>
                <tbody>
                  {subjects.map(s => (
                    <tr key={s._id} style={trBody}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                      <td style={tdStyle}>{s.code || '—'}</td>
                      <td style={tdStyle}>{s.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ====== TEACHER ASSIGNMENTS TAB ====== */}
      {tab === 'assignments' && (
        <>
          {canManage && !showAssignForm && (
            <button onClick={() => setShowAssignForm(true)} style={btnPrimary}><FiPlus size={14} /> Assign Teacher</button>
          )}
          {showAssignForm && (
            <form onSubmit={assignTeacher} style={formBox}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Teacher *</label>
                  <select value={assignForm.teacherId} onChange={e => setAssignForm({ ...assignForm, teacherId: e.target.value })} style={inputStyle}>
                    <option value="">Select teacher</option>
                    {teachers.map(t => <option key={t._id} value={t._id}>{t.fullname || t.email}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Subject *</label>
                  <select value={assignForm.subjectId} onChange={e => setAssignForm({ ...assignForm, subjectId: e.target.value })} style={inputStyle}>
                    <option value="">Select subject</option>
                    {subjects.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Class *</label>
                  <select value={assignForm.classId} onChange={e => setAssignForm({ ...assignForm, classId: e.target.value })} style={inputStyle}>
                    <option value="">Select class</option>
                    {classrooms.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Term *</label>
                  <select value={assignForm.termId} onChange={e => setAssignForm({ ...assignForm, termId: e.target.value })} style={inputStyle}>
                    <option value="">Select term</option>
                    {terms.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={btnRow}>
                <button type="submit" disabled={submitting} style={btnPrimary}>{submitting ? 'Assigning…' : 'Assign'}</button>
                <button type="button" onClick={() => setShowAssignForm(false)} style={btnOutline}>Cancel</button>
              </div>
            </form>
          )}
          <div style={{ marginTop: 16 }}>
            {assignments.length === 0 ? (
              <div style={emptyState}>No teacher assignments yet. Assign a teacher to a subject & class.</div>
            ) : (
              <table style={tableStyle}>
                <thead><tr style={trHead}>
                  <th style={thStyle}>Teacher</th>
                  <th style={thStyle}>Subject</th>
                  <th style={thStyle}>Class</th>
                  <th style={thStyle}>Term</th>
                  {canManage && <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>}
                </tr></thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a._id} style={trBody}>
                      <td style={tdStyle}>{a.teacherId?.fullname || getTeacherName(a.teacherId?._id || a.teacherId)}</td>
                      <td style={tdStyle}>{a.subjectId?.name || getSubjectName(a.subjectId?._id || a.subjectId)}</td>
                      <td style={tdStyle}>{a.classId?.name || getClassName(a.classId?._id || a.classId)}</td>
                      <td style={tdStyle}>{a.termId?.name || getTermName(a.termId?._id || a.termId)}</td>
                      {canManage && (
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <button onClick={() => removeAssignment(a._id)} style={{ ...btnSmall, color: '#dc2626' }}><FiX size={12} /> Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ====== ENROLL MODAL ====== */}
      {showEnrollModal && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Enroll Students — {getClassName(showEnrollModal)}
              </h3>
              <button onClick={() => { setShowEnrollModal(null); setEnrollIds([]); setEnrollReason(''); }} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><FiX size={18} /></button>
            </div>
            {students.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No active students found. Invite students first.</p>
            ) : (
              <>
                <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
                  {students.map(s => {
                    const cls = classrooms.find(c => c._id === showEnrollModal);
                    const alreadyEnrolled = cls?.studentIds?.some(id => id === s._id);
                    return (
                      <label key={s._id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid #f3f4f6', cursor: alreadyEnrolled ? 'default' : 'pointer', opacity: alreadyEnrolled ? 0.5 : 1 }}>
                        <input
                          type="checkbox"
                          disabled={alreadyEnrolled}
                          checked={enrollIds.includes(s._id)}
                          onChange={e => {
                            const id = s._id;
                            setEnrollIds(prev => e.target.checked ? [...prev, id] : prev.filter(x => x !== id));
                          }}
                        />
                        <span style={{ fontSize: 14 }}>{s.fullname || s.email} {alreadyEnrolled ? '(enrolled)' : ''}</span>
                      </label>
                    );
                  })}
                </div>
                {user?.orgRole === 'it_admin' && enrollIds.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ ...labelStyle, fontSize: 12 }}>Reason for Move (Optional)</label>
                    <textarea 
                      value={enrollReason} 
                      onChange={e => setEnrollReason(e.target.value)} 
                      placeholder="e.g., Transfer requested by student"
                      style={{ ...inputStyle, minHeight: 60, padding: '8px' }}
                    />
                    <small style={{ color: '#6b7280', fontSize: 11, display: 'block', marginTop: 4 }}>
                      If any selected student is already in a different class, a Move Request will be sent to the Principal for approval. Direct enrollments happen immediately.
                    </small>
                  </div>
                )}
                <button onClick={enrollStudents} disabled={submitting || enrollIds.length === 0} style={btnPrimary}>
                  {submitting ? 'Enrolling…' : `Enroll ${enrollIds.length} Student${enrollIds.length !== 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const btnOutline = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: '#fff', color: '#0a0a0a', border: '1px solid #e5e7eb', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const btnSmall = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#fff', color: '#0a0a0a', border: '1px solid #e5e7eb', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' };
const formBox = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 8 };
const gridThree = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 };
const btnRow = { display: 'flex', gap: 8 };
const labelStyle = { fontSize: 13, fontWeight: 600, color: '#333', display: 'block', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const emptyState = { background: '#f9fafb', borderRadius: 10, padding: 40, textAlign: 'center', color: '#6b7280' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const trHead = { borderBottom: '1px solid #e5e7eb' };
const trBody = { borderBottom: '1px solid #f3f4f6' };
const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#6b7280' };
const tdStyle = { padding: '10px 12px' };
const modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalBox = { background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 480, maxHeight: '80vh', overflowY: 'auto' };

export default ClassManager;
