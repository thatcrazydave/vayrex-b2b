import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { FiArrowLeft, FiSave, FiSend, FiCheckCircle, FiSettings } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { showToast } from '../utils/toast';

function GradeBook() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const isTeacher = user?.orgRole === 'teacher';
  const isAdmin = ['owner', 'org_admin'].includes(user?.orgRole);

  const [assignments, setAssignments] = useState([]);
  const [selectedAssign, setSelectedAssign] = useState(null);
  const [students, setStudents] = useState([]);
  const [grades, setGrades] = useState([]);
  const [editScores, setEditScores] = useState({}); // { [studentId]: { [componentName]: value } }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgComponents, setOrgComponents] = useState([
    { name: 'CA1', maxScore: 100, isExam: false },
    { name: 'CA2', maxScore: 100, isExam: false },
    { name: 'MidTerm', maxScore: 100, isExam: false },
    { name: 'Exam', maxScore: 100, isExam: true },
  ]);
  // Derive the components to display in the table (current + legacy from data)
  const displayComponents = React.useMemo(() => {
    const comps = [...orgComponents];
    const existingNames = new Set(comps.map(c => c.name));
    
    // Scan loaded grades for any component types not in current settings
    grades.forEach(g => {
      (g.components || []).forEach(c => {
        if (!existingNames.has(c.type)) {
          existingNames.add(c.type);
          comps.push({
            name: c.type,
            maxScore: c.maxScore || 100,
            isExam: !!c.isExam,
            isLegacy: true
          });
        }
      });
    });
    return comps;
  }, [orgComponents, grades]);

  const componentNames = displayComponents.map(c => c.name);

  useEffect(() => {
    if (!orgId) return;

    // Load org grading components
    API.get(`/org/${orgId}/grading-settings`)
      .then(res => {
        const comps = res.data?.gradingSettings?.scoreComponents;
        if (Array.isArray(comps) && comps.length > 0) {
          setOrgComponents([...comps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
        }
      })
      .catch(() => { /* keep defaults */ });

    const fetchAssignments = async () => {
      try {
        if (isTeacher) {
          const res = await API.get(`/org/${orgId}/subjects/my-assignments`);
          setAssignments(res.data.assignments || []);
        } else if (isAdmin) {
          const res = await API.get(`/org/${orgId}/subjects/assignments`);
          setAssignments(res.data.assignments || []);
        }
      } catch { /* empty */ }
      setLoading(false);
    };
    fetchAssignments();
  }, [orgId]);

  const loadGrades = async (assign) => {
    setSelectedAssign(assign);
    setLoading(true);
    try {
      const classId = assign.classroomId?._id || assign.classroomId || assign.classId?._id || assign.classId;
      const termId = assign.termId?._id || assign.termId;

      // Fetch class-wide grades
      const gRes = await API.get(`/org/${orgId}/gradebook/class/${classId}/term/${termId}`);
      const all = gRes.data.grades || gRes.data.report?.grades || [];

      // Filter for this subject
      const subjectId = assign.subjectId?._id || assign.subjectId;
      const filtered = all.filter(g => {
        const gSub = g.subjectId?._id || g.subjectId;
        return gSub === subjectId;
      });
      setGrades(filtered);

      // Get students in the class from classroom enrollment
      const sRes = await API.get(`/org/${orgId}/classrooms/${classId}/students`);
      const classStudents = (sRes.data.students || []).filter(s => s.isActive !== false);
      setStudents(classStudents);

      // Pre-fill editScores from existing grades
      const scores = {};
      filtered.forEach(g => {
        const sid = g.studentId?._id || g.studentId;
        scores[sid] = {};
        (g.components || []).forEach(c => { scores[sid][c.type] = c.score; });
      });
      setEditScores(scores);
    } catch (err) {
      showToast.error('Failed to load grades');
    }
    setLoading(false);
  };

  const updateScore = (studentId, type, value) => {

    setEditScores(prev => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || {}), [type]: value === '' ? '' : Number(value) }
    }));
  };

  const saveGrade = async (studentId) => {
    const scores = editScores[studentId] || {};
    const components = componentNames
      .filter(name => scores[name] !== undefined && scores[name] !== '')
      .map(name => {
        const def = orgComponents.find(c => c.name === name) || {};
        return { type: name, score: Number(scores[name]), maxScore: def.maxScore || 100, isExam: !!def.isExam };
      });
    if (components.length === 0) return showToast.warning('Enter at least one score');

    const subjectId = selectedAssign.subjectId?._id || selectedAssign.subjectId;
    const termId = selectedAssign.termId?._id || selectedAssign.termId;
    const classId = selectedAssign.classroomId?._id || selectedAssign.classroomId || selectedAssign.classId?._id || selectedAssign.classId;

    setSaving(true);
    try {
      await API.put(`/org/${orgId}/gradebook/${studentId}/${subjectId}/${termId}`, { components, classId });
      showToast.success('Grade saved');
      loadGrades(selectedAssign);
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to save');
    }
    setSaving(false);
  };

  const submitForReview = async () => {
    const subjectId = selectedAssign.subjectId?._id || selectedAssign.subjectId;
    const termId = selectedAssign.termId?._id || selectedAssign.termId;
    const classId = selectedAssign.classroomId?._id || selectedAssign.classroomId || selectedAssign.classId?._id || selectedAssign.classId;

    try {
      await API.post(`/org/${orgId}/gradebook/submit-for-review`, { classId, subjectId, termId });
      showToast.success('Grades submitted for review');
      loadGrades(selectedAssign);
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed');
    }
  };

  const publishGrades = async () => {
    const subjectId = selectedAssign.subjectId?._id || selectedAssign.subjectId;
    const termId = selectedAssign.termId?._id || selectedAssign.termId;
    const classId = selectedAssign.classroomId?._id || selectedAssign.classroomId || selectedAssign.classId?._id || selectedAssign.classId;

    try {
      await API.post(`/org/${orgId}/gradebook/publish`, { classId, subjectId, termId });
      showToast.success('Grades published');
      loadGrades(selectedAssign);
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed');
    }
  };

  const backLink = isTeacher ? '/teacher' : '/org-admin';

  const isOrgAdmin = isAdmin;

  if (loading && !selectedAssign) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        {selectedAssign ? (
          <button onClick={() => setSelectedAssign(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#0a0a0a' }}><FiArrowLeft size={18} /></button>
        ) : (
          <Link to={backLink} style={{ color: '#0a0a0a' }}><FiArrowLeft size={18} /></Link>
        )}
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Grade Book</h1>
        {isOrgAdmin && (
          <Link to="/org-admin/grading-settings" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 7, padding: '5px 12px', textDecoration: 'none' }}>
            <FiSettings size={13} /> Grading Settings
          </Link>
        )}
      </div>

      {/* Assignment picker */}
      {!selectedAssign ? (
        <>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem', fontSize: 14 }}>
            Select a subject assignment to enter or view grades.
          </p>
          {assignments.length === 0 ? (
            <div style={emptyState}>No subject assignments found. {isTeacher ? 'Ask your admin to assign you to a subject.' : 'Assign teachers to subjects first.'}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {assignments.map(a => (
                <div key={a._id} onClick={() => loadGrades(a)} style={cardStyle}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{a.subject?.name || a.subjectId?.name || 'Subject'}</div>
                  <div style={{ fontSize: 13, color: '#6b7280' }}>{a.classroom?.name || a.classroomId?.name || 'Class'}</div>
                  <div style={{ fontSize: 13, color: '#6b7280' }}>{a.term?.name || a.termId?.name || 'Term'}</div>
                  {a.teacher && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{a.teacher.fullname || a.teacher.email}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Grade entry table */}
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>
            {selectedAssign.subject?.name || selectedAssign.subjectId?.name} — {selectedAssign.classroom?.name || selectedAssign.classroomId?.name} — {selectedAssign.term?.name || selectedAssign.termId?.name}
          </p>

          {/* Bulk actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {isTeacher && grades.some(g => g.status === 'draft') && (
              <button onClick={submitForReview} style={btnPrimary}><FiSend size={13} /> Submit for Review</button>
            )}
            {(isAdmin || isTeacher) && grades.some(g => g.status === 'reviewed') && (
              <button onClick={publishGrades} style={btnPrimary}><FiCheckCircle size={13} /> Publish</button>
            )}
          </div>

          {loading ? (
            <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading grades…</div>
          ) : students.length === 0 ? (
            <div style={emptyState}>No students enrolled in this class yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={thStyle}>Student</th>
                    {displayComponents.map(c => (
                      <th key={c.name} style={{ ...thStyle, textAlign: 'center', width: 80 }}>
                        <span>{c.name} {c.isLegacy && <span style={{fontSize: 9, color: '#ef4444'}}>(old)</span>}</span>
                        <span style={{ display: 'block', fontSize: 10, color: '#9ca3af', fontWeight: 400 }}>/{c.maxScore}</span>
                      </th>
                    ))}
                    <th style={{ ...thStyle, textAlign: 'center', width: 70 }}>Total</th>
                    <th style={{ ...thStyle, textAlign: 'center', width: 80 }}>Status</th>
                    {isTeacher && <th style={{ ...thStyle, textAlign: 'right', width: 70 }}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {students.map(s => {
                    const sid = s.userId || s._id;
                     const existing = grades.find(g => (g.studentId?._id || g.studentId) === sid);
                    const scores = editScores[sid] || {};
                    const total = componentNames.reduce((sum, name) => sum + (Number(scores[name]) || 0), 0);

                    return (
                      <tr key={sid} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{s.fullname || s.email}</td>
                        {displayComponents.map(comp => (
                          <td key={comp.name} style={{ ...tdStyle, textAlign: 'center' }}>
                            {isTeacher && (!existing || existing.status === 'draft') ? (
                              <input
                                type="number"
                                min="0"
                                max={comp.maxScore}
                                value={scores[comp.name] ?? ''}
                                onChange={e => updateScore(sid, comp.name, e.target.value)}
                                style={{ width: 60, padding: '4px 6px', border: '1px solid #e5e7eb', borderRadius: 6, textAlign: 'center', fontSize: 13 }}
                                disabled={comp.isLegacy}
                                title={comp.isLegacy ? "Legacy column. Update grading settings to include this component if you want to edit it." : ""}
                                placeholder={comp.isLegacy ? "—" : ""}
                              />
                            ) : (
                              <span>{scores[comp.name] ?? '—'}</span>
                            )}
                          </td>
                        ))}
                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{total || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {existing ? <span style={existing.status === 'published' ? badgePublished : existing.status === 'reviewed' ? badgeReviewed : badgeDraft}>{existing.status}</span> : <span style={badgeEmpty}>—</span>}
                        </td>
                        {isTeacher && (
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {(!existing || existing.status === 'draft') && (
                              <button onClick={() => saveGrade(sid)} disabled={saving} style={btnSmall}>
                                <FiSave size={11} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: '#0a0a0a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const btnSmall = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: '#fff', color: '#0a0a0a', border: '1px solid #e5e7eb', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' };
const emptyState = { background: '#f9fafb', borderRadius: 10, padding: 40, textAlign: 'center', color: '#6b7280' };
const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#6b7280' };
const tdStyle = { padding: '10px 12px' };
const cardStyle = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, cursor: 'pointer', transition: 'box-shadow 0.15s', background: '#fff' };
const badgeDraft = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e' };
const badgeReviewed = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#e0e7ff', color: '#3730a3' };
const badgePublished = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#0a0a0a', color: '#fff' };
const badgeEmpty = { fontSize: 11, color: '#d1d5db' };

export default GradeBook;
