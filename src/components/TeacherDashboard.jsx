import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import {
  FiBook, FiCheckSquare, FiUpload, FiAlertCircle, FiArrowRight, FiChevronDown
} from 'react-icons/fi';

/**
 * TeacherDashboard — Teacher view
 * Route: /teacher  (per master plan Section 12 / Section 7o)
 */
function TeacherDashboard() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const [assignments, setAssignments] = useState([]);
  const [draftGrades, setDraftGrades] = useState(0);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    const load = async () => {
      try {
        const [assignRes, gradesRes] = await Promise.allSettled([
          API.get(`/org/${orgId}/subjects/my-assignments`),
          API.get(`/org/${orgId}/gradebook?status=draft`),
        ]);

        const assignData = assignRes.status === 'fulfilled' ? assignRes.value.data : null;
        const gradesData = gradesRes.status === 'fulfilled' ? gradesRes.value.data : null;

        const myAssignments = assignData?.assignments || [];
        setAssignments(myAssignments);
        if (myAssignments.length > 0) setSelectedAssignment(myAssignments[0]);
        setDraftGrades(gradesData?.total || 0);
      } catch (_) { /* keep defaults */ }
      setLoading(false);
    };
    load();
  }, [orgId]);

  return (
    <div className="dashboard-page" style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Teacher Dashboard</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.4rem', fontSize: '1rem' }}>
          Welcome back, <span style={{ fontWeight: 600 }}>{user?.fullname || user?.username}</span>
        </p>
      </div>

      {/* Top Stats Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
        <OverviewCard 
          icon={<FiBook size={22} />} 
          label="Active Classes" 
          value={loading ? '…' : assignments.length} 
          sub="Subjects assigned to you" 
          color="#2563eb"
          bg="#eff6ff"
        />
        <OverviewCard 
          icon={<FiCheckSquare size={22} />} 
          label="Pending Grades" 
          value={loading ? '…' : draftGrades} 
          sub="Drafts awaiting submission" 
          color={draftGrades > 0 ? "#ea580c" : "#16a34a"}
          bg={draftGrades > 0 ? "#fff7ed" : "#f0fdf4"}
        />
      </div>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', alignItems: 'start' }}>
        
        {/* Left Column / Main Area */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Your Subject Assignments</h2>
          </div>
          
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', background: '#fff', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
              Loading your classes...
            </div>
          ) : assignments.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
              {assignments.map(a => (
                <div key={a._id} style={{
                  background: '#ffffff',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.05)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)';
                }}>
                  {/* Subtle top border accent */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, #1e293b, #334155)' }} />
                  
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h3 style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
                        {a.subjectId?.name || 'Subject'}
                      </h3>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '0.25rem 0.6rem',
                        borderRadius: '1rem',
                        background: a.isActive ? '#e0f2fe' : '#f1f5f9',
                        color: a.isActive ? '#0369a1' : '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        {a.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      <strong>{a.classId?.name || 'Class'}</strong> · {a.termId?.name || 'Term'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto', paddingTop: '0.5rem' }}>
                    <Link to="/teacher/gradebook" style={actionBtn}>
                      <FiBook size={14} /> Gradebook
                    </Link>
                    <Link to="/teacher/attendance" style={{ ...actionBtn, background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0' }}>
                      <FiCheckSquare size={14} /> Attendance
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: 'var(--background-light)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '3rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              <FiBook size={32} style={{ marginBottom: '1rem', opacity: 0.5 }} />
              <p style={{ margin: 0, fontSize: '1.05rem' }}>You have no subject assignments yet.</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', opacity: 0.8 }}>Contact your school administrator to get assigned to a class.</p>
            </div>
          )}
        </section>

        {/* Right Column / Alerts */}
        {draftGrades > 0 && (
          <section>
            <div style={{ 
              background: 'linear-gradient(to right, #fff7ed, #ffedd5)', 
              border: '1px solid #fdba74',
              borderRadius: 'var(--radius-lg)', 
              padding: '1.5rem', 
              color: '#c2410c',
              boxShadow: 'var(--shadow-sm)',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{ position: 'absolute', right: '-10px', top: '-10px', opacity: 0.1 }}>
                <FiAlertCircle size={100} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', position: 'relative', zIndex: 1 }}>
                <FiAlertCircle size={20} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Action Required</h3>
              </div>
              <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.95rem', lineHeight: 1.5, position: 'relative', zIndex: 1 }}>
                You have <strong>{draftGrades} draft grade entries</strong> that need your attention. Please review and submit them to the Principal.
              </p>
              <Link to="/teacher/gradebook" style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                background: '#ea580c', color: '#fff', padding: '0.6rem 1.2rem',
                borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none',
                position: 'relative', zIndex: 1
              }}>
                Go to Gradebook <FiArrowRight size={14} />
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function OverviewCard({ icon, label, value, sub, color, bg }) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-lg)',
      padding: '1.5rem',
      display: 'flex',
      alignItems: 'center',
      gap: '1.25rem',
      boxShadow: 'var(--shadow-xs)',
      transition: 'all 0.2s ease',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.transform = 'translateY(-2px)';
      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
    }}>
      <div style={{ 
        width: '56px', height: '56px', borderRadius: '1rem', 
        background: bg, color: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.1rem' }}>{label}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{sub}</div>
      </div>
    </div>
  );
}

const actionBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.6rem 1rem',
  background: '#0f172a',
  color: '#fff',
  borderRadius: '0.5rem',
  fontWeight: 600,
  fontSize: '0.85rem',
  textDecoration: 'none',
  flex: 1,
  transition: 'opacity 0.2s',
};

export default TeacherDashboard;
