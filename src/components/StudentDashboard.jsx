import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import {
  FiBook, FiCheckSquare, FiArrowRight, FiClock, FiAward, FiCalendar, FiBell
} from 'react-icons/fi';

/**
 * StudentDashboard — Student view
 * Route: /student  (per master plan Section 12 / Section 7o)
 */
function StudentDashboard() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const [grades, setGrades] = useState([]);
  const [dueSoon, setDueSoon] = useState([]);
  const [attendance, setAttendance] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !user?.id) return;
    const load = async () => {
      try {
        const [gradesRes, assignRes, attRes, annRes] = await Promise.allSettled([
          API.get(`/org/${orgId}/gradebook/student/${user.id}`),
          API.get(`/org/${orgId}/assignments?status=assigned&limit=5`),
          API.get(`/org/${orgId}/attendance/student/${user.id}`),
          API.get(`/org/${orgId}/announcements?limit=5`),
        ]);

        setGrades(gradesRes.status === 'fulfilled' ? (gradesRes.value.data?.grades || []) : []);

        // Filter assignments due in the next 7 days
        if (assignRes.status === 'fulfilled') {
          const all = assignRes.value.data?.assignments || [];
          const now = new Date();
          const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          setDueSoon(all.filter(a => {
            if (!a.dueDate) return true;
            const d = new Date(a.dueDate);
            return d <= weekFromNow && d >= now;
          }));
        }

        if (attRes.status === 'fulfilled') {
          setAttendance(attRes.value.data?.summary || null);
        }

        setAnnouncements(annRes.status === 'fulfilled' ? (annRes.value.data?.announcements || []) : []);
      } catch (_) { /* keep empty */ }
      setLoading(false);
    };
    load();
  }, [orgId, user?.id]);

  return (
    <div className="dashboard-page" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>
            Good day, {user?.fullname?.split(' ')[0] || user?.username}
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Here's what's happening today.
          </p>
        </div>
        {/* Attendance badge */}
        {attendance && (
          <div style={{
            background: attendance.percentage >= 75 ? '#eff6ff' : '#fff7ed',
            color: attendance.percentage >= 75 ? '#1d4ed8' : '#c2410c',
            border: `1px solid ${attendance.percentage >= 75 ? '#bfdbfe' : '#fed7aa'}`,
            borderRadius: 'var(--radius-md)',
            padding: '0.5rem 1rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}>
            <FiCalendar size={14} />
            {attendance.percentage}% Attendance
          </div>
        )}
      </div>

      {/* Due soon */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FiClock size={16} color="var(--accent)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Due Soon</h2>
        </div>
        {dueSoon.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {dueSoon.map((a) => (
              <Link key={a._id} to={`/student/assignments/${a._id}`} style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.875rem 1.125rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'box-shadow 0.15s, transform 0.15s',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{a.title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {a.subjectId?.name || 'Subject'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {a.mySubmission ? (
                      <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <FiCheckSquare size={13} /> Submitted
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.8rem', color: '#c2410c', fontWeight: 600 }}>
                        Due {new Date(a.dueDate).toLocaleDateString()}
                      </div>
                    )}
                    <FiArrowRight size={14} color="#94a3b8" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {loading ? 'Loading...' : 'No upcoming due dates.'}
          </div>
        )}
      </section>

      {/* My Subjects (from published grades) */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FiBook size={16} /> My Subjects
          </h2>
        </div>
        {grades.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {[...new Map(grades.map(g => [g.subjectId?._id, g.subjectId])).values()].map(sub => (
              <div key={sub?._id} style={{
                background: 'var(--background-light)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1rem',
                fontWeight: 500,
              }}>
                {sub?.name || 'Unknown Subject'} {sub?.code ? `(${sub.code})` : ''}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {loading ? 'Loading...' : 'Subjects will appear here once your teacher publishes grades.'}
          </div>
        )}
      </section>

      {/* Recent results */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FiAward size={16} color="var(--primary)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Recent Results</h2>
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
                {grades.slice(0, 10).map(g => (
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

      {/* Announcements */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <FiBell size={16} color="var(--primary)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Announcements</h2>
        </div>
        {announcements.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {announcements.map((a) => (
              <div key={a._id} style={{
                background: 'var(--background-light)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1rem',
              }}>
                <div style={{ fontWeight: 500, marginBottom: '0.15rem' }}>{a.title}</div>
                {a.body && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{a.body.substring(0, 120)}{a.body.length > 120 ? '...' : ''}</div>}
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {new Date(a.createdAt).toLocaleDateString()}
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

export default StudentDashboard;
