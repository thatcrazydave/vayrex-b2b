import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import {
  FiCheckSquare, FiBarChart2, FiCalendar, FiFileText, FiBell, FiUser
} from 'react-icons/fi';

/**
 * GuardianPortal — Read-only guardian view
 * Route: /guardian-portal  (per master plan Section 12 / Section 7n)
 *
 * Uses the guardian backend routes to fetch data per child.
 */
function GuardianPortal() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [grades, setGrades] = useState([]);
  const [attendance, setAttendance] = useState(null);
  const [reportCards, setReportCards] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load children list with names
  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    const loadChildren = async () => {
      try {
        const res = await API.get(`/org/${orgId}/guardian/children`);
        const list = res.data?.children || [];
        setChildren(list);
        if (list.length > 0) setSelectedChild(list[0]._id);
      } catch (_) { /* keep empty */ }
      setLoading(false);
    };
    loadChildren();
  }, [orgId]);

  // Load data for selected child
  useEffect(() => {
    if (!orgId || !selectedChild) return;
    const loadChildData = async () => {
      setLoading(true);
      try {
        const [gradesRes, attendanceRes, rcRes, annRes] = await Promise.allSettled([
          API.get(`/org/${orgId}/guardian/children/${selectedChild}/grades`),
          API.get(`/org/${orgId}/guardian/children/${selectedChild}/attendance`),
          API.get(`/org/${orgId}/guardian/children/${selectedChild}/report-cards`),
          API.get(`/org/${orgId}/guardian/children/${selectedChild}/announcements`),
        ]);
        setGrades(gradesRes.status === 'fulfilled' ? (gradesRes.value.data?.grades || []) : []);
        setAttendance(attendanceRes.status === 'fulfilled' ? attendanceRes.value.data : null);
        setReportCards(rcRes.status === 'fulfilled' ? (rcRes.value.data?.reportCards || []) : []);
        setAnnouncements(annRes.status === 'fulfilled' ? (annRes.value.data?.announcements || []) : []);
      } catch (_) { /* keep empty */ }
      setLoading(false);
    };
    loadChildData();
  }, [orgId, selectedChild]);

  const selectedChildObj = children.find((c) => c._id === selectedChild);

  return (
    <div className="dashboard-page" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Guardian Portal</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Welcome, {user?.fullname || user?.username}
        </p>
      </div>

      {/* Child selector */}
      <div style={{
        background: 'var(--primary)',
        color: '#fff',
        borderRadius: 'var(--radius-md)',
        padding: '1rem 1.25rem',
        marginBottom: '2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <FiUser size={16} />
        {children.length > 1 ? (
          <select
            value={selectedChild || ''}
            onChange={(e) => setSelectedChild(e.target.value)}
            style={{ background: 'transparent', color: '#fff', border: 'none', fontWeight: 500, fontSize: '0.95rem', flexGrow: 1 }}
          >
            {children.map((child) => (
              <option key={child._id} value={child._id} style={{ color: '#000' }}>
                {child.fullname || child.email || child._id}
                {child.classId?.name ? ` — ${child.classId.name}` : ''}
              </option>
            ))}
          </select>
        ) : children.length === 1 ? (
          <span style={{ fontWeight: 500, flexGrow: 1 }}>
            Viewing: {children[0].fullname || children[0].email}
            {children[0].classId?.name ? ` — ${children[0].classId.name}` : ''}
          </span>
        ) : (
          <span style={{ fontWeight: 500, flexGrow: 1 }}>
            No linked children found. Please contact the school administrator.
          </span>
        )}
      </div>

      {/* Attendance summary */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FiCalendar size={16} color="var(--primary)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Attendance</h2>
        </div>
        {attendance?.summary ? (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              <span>Present: <strong>{attendance.summary.present}</strong></span>
              <span>Absent: <strong>{attendance.summary.absent}</strong></span>
              <span>Late: <strong>{attendance.summary.late}</strong></span>
              <span>Excused: <strong>{attendance.summary.excused}</strong></span>
            </div>
            <div style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              color: attendance.summary.percentage >= 75 ? 'var(--success, green)' : 'var(--danger, red)',
            }}>
              {attendance.summary.percentage}% Attendance Rate
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {loading ? 'Loading...' : 'No attendance data available.'}
          </div>
        )}
      </section>

      {/* Published grades */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FiBarChart2 size={16} color="var(--primary)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Published Grades</h2>
        </div>
        {grades.length > 0 ? (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Subject</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Score</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Grade</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Remark</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g._id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>{g.subjectId?.name || '—'}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>{g.finalScore}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>{g.letterGrade}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{g.remark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {loading ? 'Loading...' : 'No published grades yet for this term.'}
          </div>
        )}
      </section>

      {/* Report cards */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FiFileText size={16} color="var(--primary)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Report Cards</h2>
        </div>
        {reportCards.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {reportCards.map((rc) => (
              <div key={rc._id} style={{
                background: 'var(--background-light)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem 1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{rc.termId?.name || 'Term'}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {rc.classId?.name || 'Class'} · Position: {rc.classPosition || '—'} / {rc.classSize || '—'}
                  </div>
                </div>
                <span style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--success-bg, #e6f9e6)',
                  color: 'var(--success, green)',
                }}>
                  Published
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {loading ? 'Loading...' : 'Published report cards will appear here.'}
          </div>
        )}
      </section>

      {/* Announcements */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FiBell size={16} color="var(--primary)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>School Announcements</h2>
        </div>
        {announcements.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {announcements.slice(0, 10).map((a) => (
              <div key={a._id} style={{
                background: 'var(--background-light)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem 1.25rem',
              }}>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{a.title}</div>
                {a.body && <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{a.body}</div>}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {a.createdBy?.fullname || a.createdBy?.name || ''} · {new Date(a.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {loading ? 'Loading...' : 'No announcements.'}
          </div>
        )}
      </section>
    </div>
  );
}

export default GuardianPortal;
