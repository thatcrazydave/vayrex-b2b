import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import {
  FiUsers, FiBarChart2, FiCalendar, FiBook, FiCheckSquare,
  FiAlertCircle, FiArrowRight, FiGrid, FiCheck, FiX, FiSliders
} from 'react-icons/fi';
import { showToast } from '../utils/toast';

/**
 * OrgAdminDashboard — Principal / Org Admin / Owner view
 * Route: /org-admin  (per master plan Section 12)
 */
function OrgAdminDashboard() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const [stats, setStats] = useState({ members: '—', classes: '—', activeTerm: '—', academicYear: '—', teachers: '—', students: '—' });
  const [classes, setClasses] = useState([]);
  const [pendingGrades, setPendingGrades] = useState(0);
  const [moveRequests, setMoveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actioningRequest, setActioningRequest] = useState(null);

  useEffect(() => {
    if (!orgId) return;
    const load = async () => {
      try {
        const [membersRes, classRes, yearsRes, gradesRes, moveRes] = await Promise.allSettled([
          API.get(`/org/${orgId}/members`),
          API.get(`/org/${orgId}/classrooms`),
          API.get(`/org/${orgId}/academic-years`),
          API.get(`/org/${orgId}/gradebook?status=reviewed`),
          user?.orgRole !== 'it_admin' ? API.get(`/org/${orgId}/move-requests`) : Promise.resolve({ data: { requests: [] } }),
        ]);

        const members = membersRes.status === 'fulfilled' ? membersRes.value.data : null;
        const classData = classRes.status === 'fulfilled' ? classRes.value.data : null;
        const yearsData = yearsRes.status === 'fulfilled' ? yearsRes.value.data : null;
        const gradesData = gradesRes.status === 'fulfilled' ? gradesRes.value.data : null;
        const movesData = moveRes.status === 'fulfilled' ? moveRes.value.data : null;

        const memberCount = members?.members?.length ?? members?.total ?? '—';
        const allMembers = members?.members || [];
        const teacherCount = allMembers.filter(m => m.orgRole === 'teacher').length;
        const studentCount = allMembers.filter(m => m.orgRole === 'student').length;
        const classList = classData?.classrooms || [];
        const activeYear = (yearsData?.academicYears || []).find(y => y.isActive);
        const activeTerm = activeYear?.terms?.find(t => t.isActive);

        setStats({
          members: memberCount,
          classes: classList.filter(c => c.isActive).length || '—',
          activeTerm: activeTerm?.name || 'Not set',
          academicYear: activeYear?.name || 'Not set',
          teachers: teacherCount,
          students: studentCount,
        });
        setClasses(classList.slice(0, 5));
        setPendingGrades(gradesData?.total || 0);
        setMoveRequests((movesData?.requests || []).filter(r => r.status === 'pending'));
      } catch (_) { /* keep defaults */ }
      setLoading(false);
    };
    load();
  }, [orgId, user?.orgRole]);

  const handleMoveAction = async (requestId, action) => {
    setActioningRequest(requestId);
    try {
      await API.patch(`/org/${orgId}/move-requests/${requestId}/${action}`);
      showToast.success(`Transfer ${action}d successfully`);
      setMoveRequests(prev => prev.filter(r => r._id !== requestId));
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || `Failed to ${action} transfer`);
    }
    setActioningRequest(null);
  };

  return (
    <div className="dashboard-page" style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>
          {user?.orgRole === 'owner' ? 'Principal Dashboard' : user?.orgRole === 'it_admin' ? 'IT Admin Dashboard' : 'Admin Dashboard'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Welcome back, {user?.fullname || user?.username}
        </p>
      </div>

      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <OverviewCard icon={<FiUsers size={20} />} label="Total Members" value={loading ? '…' : stats.members} sub="Across all roles" />
        <OverviewCard icon={<FiBook size={20} />} label="Active Classes" value={loading ? '…' : stats.classes} sub="This term" />
        <OverviewCard icon={<FiCalendar size={20} />} label="Active Term" value={loading ? '…' : stats.activeTerm} sub={stats.academicYear} />
        <OverviewCard icon={<FiBarChart2 size={20} />} label="Grades Awaiting Publish" value={loading ? '…' : pendingGrades} sub="Reviewed, not published" />
        <OverviewCard icon={<FiUsers size={20} />} label="Teachers" value={loading ? '…' : stats.teachers} sub="Active staff" />
        <OverviewCard icon={<FiUsers size={20} />} label="Students" value={loading ? '…' : stats.students} sub="Enrolled students" />
      </div>

      {/* Quick actions have been moved to the Navbar */}

      {/* Pending actions */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FiAlertCircle size={16} color="var(--text-primary)" /> Pending Actions
        </h2>
        
        {/* Grade actions */}
        <div style={{ 
          background: '#ffffff', 
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', 
          padding: '2rem', 
          color: 'var(--text-secondary)', 
          textAlign: 'center',
          boxShadow: 'var(--shadow-xs)',
          marginBottom: '1rem'
        }}>
          {pendingGrades > 0
            ? `${pendingGrades} grade batch(es) reviewed and awaiting publish.`
            : 'No pending actions — your school is up to date.'}
        </div>

        {/* Transfer requests (Principal/OrgAdmin only) */}
        {['owner', 'org_admin'].includes(user?.orgRole) && moveRequests.length > 0 && (
          <div style={{ 
            background: '#ffffff', 
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', 
            overflow: 'hidden',
            boxShadow: 'var(--shadow-xs)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--background-light)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Transfer Request</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Reason</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Requested By</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {moveRequests.map(req => (
                  <tr key={req._id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <strong>{req.studentId?.fullname || req.studentId?.email}</strong><br/>
                      <span style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>
                        {req.sourceClassId?.name} → {req.targetClassId?.name}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{req.reason || '—'}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{req.requestedBy?.fullname || req.requestedBy?.email}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <button 
                        onClick={() => handleMoveAction(req._id, 'approve')}
                        disabled={actioningRequest === req._id}
                        style={{ ...btnSmall, background: 'black', color: 'white', marginRight: '4px' }}
                      >
                        <FiCheck size={12} /> Approve
                      </button>
                      <button 
                        onClick={() => handleMoveAction(req._id, 'reject')}
                        disabled={actioningRequest === req._id}
                        style={{ ...btnSmall }}
                      >
                        <FiX size={12} /> Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Class overview */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Class Overview</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {['owner', 'org_admin'].includes(user?.orgRole) && (
              <Link
                to="/org-admin/grading-settings"
                style={{ fontSize: '0.8rem', color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}
              >
                <FiSliders size={11} /> Grading Settings
              </Link>
            )}
            <Link to="/org-admin/classes" style={{ fontSize: '0.85rem', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              View all <FiArrowRight size={12} />
            </Link>
          </div>
        </div>
        {classes.length > 0 ? (
          <div style={{ 
            background: '#ffffff', 
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', 
            overflow: 'hidden',
            boxShadow: 'var(--shadow-xs)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Class</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Level</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Teacher</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Students</th>
                </tr>
              </thead>
              <tbody>
                {classes.map(c => (
                  <tr key={c._id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>{c.name}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{c.level || '—'}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{c.classTeacherId?.fullname || '—'}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{c.studentIds?.length || 0} / {c.capacity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-xs)', borderRadius: 'var(--radius-md)', padding: '2rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {loading ? 'Loading…' : 'No classes configured yet. Create classrooms under Academic Calendar.'}
          </div>
        )}
      </section>
    </div>
  );
}

function OverviewCard({ icon, label, value, sub }) {
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
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
      <div style={{ color: 'var(--text-primary)' }}>{icon}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{sub}</div>
    </div>
  );
}

export default OrgAdminDashboard;

const btnSmall = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: '#fff', color: '#0a0a0a', border: '1px solid #e5e7eb', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' };

