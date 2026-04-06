import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { toast } from 'react-toastify';
import {
  FiFileText, FiDownload, FiCheckCircle, FiLoader, FiChevronDown, FiAward
} from 'react-icons/fi';

/**
 * ReportCardView — Multi-role report card component
 *
 * Admin/Owner: generate + publish + view for any class/term
 * Teacher: view report cards for assigned classes
 * Student: view own published report cards
 * Guardian: see via GuardianPortal (uses guardian routes)
 */
function ReportCardView() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const isAdmin = ['owner', 'org_admin'].includes(user?.orgRole);
  const isStudent = user?.orgRole === 'student';

  const [classes, setClasses] = useState([]);
  const [terms, setTerms] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('');

  // Admin view
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Student view
  const [reportCard, setReportCard] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    if (isStudent) {
      loadStudentReportCard();
    } else {
      loadOptions();
    }
  }, [orgId]);

  async function loadOptions() {
    try {
      const [classRes, yearRes] = await Promise.allSettled([
        API.get(`/org/${orgId}/classrooms`),
        API.get(`/org/${orgId}/academic-years`),
      ]);

      const classList = classRes.status === 'fulfilled' ? (classRes.value.data?.classrooms || []) : [];
      setClasses(classList);
      if (classList.length > 0) setSelectedClass(classList[0]._id);

      const years = yearRes.status === 'fulfilled' ? (yearRes.value.data?.academicYears || []) : [];
      const activeYear = years.find((y) => y.isActive);
      const termList = activeYear?.terms || [];
      setTerms(termList);
      const activeTerm = termList.find((t) => t.isActive);
      if (activeTerm) setSelectedTerm(activeTerm._id);
      else if (termList.length > 0) setSelectedTerm(termList[0]._id);
    } catch (_) { /* keep defaults */ }
  }

  async function loadStudentReportCard() {
    setLoading(true);
    try {
      // Fetch active year/term first
      const yearRes = await API.get(`/org/${orgId}/academic-years`);
      const years = yearRes.data?.academicYears || [];
      const activeYear = years.find((y) => y.isActive);
      const activeTerm = activeYear?.terms?.find((t) => t.isActive);

      if (activeTerm) {
        const res = await API.get(`/org/${orgId}/report-cards/${user.id}/${activeTerm._id}`);
        setReportCard(res.data?.reportCard || null);
      }
    } catch (_) {
      // 404 = report card not generated yet
    }
    setLoading(false);
  }

  async function handleGenerate() {
    if (!selectedClass || !selectedTerm) {
      toast.error('Select a class and term');
      return;
    }
    setGenerating(true);
    try {
      const res = await API.post(`/org/${orgId}/report-cards/generate`, {
        classId: selectedClass,
        termId: selectedTerm,
      });
      toast.success(res.data?.message || 'Report cards generated');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to generate');
    }
    setGenerating(false);
  }

  async function handlePublish() {
    if (!selectedClass || !selectedTerm) {
      toast.error('Select a class and term');
      return;
    }
    setPublishing(true);
    try {
      const res = await API.post(`/org/${orgId}/report-cards/publish`, {
        classId: selectedClass,
        termId: selectedTerm,
      });
      toast.success(res.data?.message || 'Report cards published');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to publish');
    }
    setPublishing(false);
  }

  // ── Student View ──────────────────────────────────────────
  if (isStudent) {
    return (
      <div className="dashboard-page" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FiFileText size={22} /> My Report Card
          </h1>
        </div>

        {loading ? (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading...
          </div>
        ) : !reportCard ? (
          <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No published report card for this term yet.
          </div>
        ) : (
          <ReportCardDetail card={reportCard} />
        )}
      </div>
    );
  }

  // ── Admin / Teacher View ──────────────────────────────────
  return (
    <div className="dashboard-page" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FiFileText size={22} /> Report Cards
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          {isAdmin ? 'Generate, review, and publish report cards.' : 'View report cards for your classes.'}
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <select
          value={selectedClass}
          onChange={(e) => setSelectedClass(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem', minWidth: '180px' }}
        >
          <option value="">Select Class</option>
          {classes.map((c) => (
            <option key={c._id} value={c._id}>{c.name} {c.level ? `(${c.level})` : ''}</option>
          ))}
        </select>

        <select
          value={selectedTerm}
          onChange={(e) => setSelectedTerm(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem', minWidth: '180px' }}
        >
          <option value="">Select Term</option>
          {terms.map((t) => (
            <option key={t._id} value={t._id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating || !selectedClass || !selectedTerm}
            style={{ gap: '6px', display: 'inline-flex', alignItems: 'center' }}
          >
            <FiAward size={14} /> {generating ? 'Generating...' : 'Generate Report Cards'}
          </button>
          <button
            className="btn btn-outline"
            onClick={handlePublish}
            disabled={publishing || !selectedClass || !selectedTerm}
            style={{ gap: '6px', display: 'inline-flex', alignItems: 'center' }}
          >
            <FiCheckCircle size={14} /> {publishing ? 'Publishing...' : 'Publish Report Cards'}
          </button>
        </div>
      )}

      <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Select a class and term, then generate report cards. Once reviewed, publish them to make them visible to students and guardians.
      </div>
    </div>
  );
}

/**
 * Shared detail view for a single report card
 */
function ReportCardDetail({ card }) {
  return (
    <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
            {card.studentId?.name || card.studentId?.fullname || 'Student'}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {card.classId?.name || 'Class'} · {card.termId?.name || 'Term'}
          </div>
        </div>
        {card.classPosition && (
          <div style={{
            background: 'var(--primary)',
            color: '#fff',
            borderRadius: 'var(--radius-sm)',
            padding: '0.35rem 0.75rem',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}>
            Position: {card.classPosition} / {card.classSize || '—'}
          </div>
        )}
      </div>

      {/* Grades table */}
      {card.grades?.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'left' }}>Subject</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>CA</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Exam</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Grade</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'left' }}>Remark</th>
              </tr>
            </thead>
            <tbody>
              {card.grades.map((g, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.75rem 0.5rem' }}>{g.subjectId?.name || '—'}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{g.caScore}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{g.examScore}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>{g.totalScore}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600 }}>{g.letterGrade}</td>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>{g.remark || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Attendance summary */}
      {card.attendanceSummary && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Attendance Summary</div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
            <span>Present: <strong>{card.attendanceSummary.present}</strong></span>
            <span>Absent: <strong>{card.attendanceSummary.absent}</strong></span>
            <span>Late: <strong>{card.attendanceSummary.late}</strong></span>
            <span>Excused: <strong>{card.attendanceSummary.excused}</strong></span>
            <span>Attendance: <strong>{card.attendanceSummary.percentage}%</strong></span>
          </div>
        </div>
      )}

      {/* Comments */}
      {(card.classTeacherComment || card.principalComment) && (
        <div>
          {card.classTeacherComment && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>Class Teacher's Comment</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{card.classTeacherComment}</div>
            </div>
          )}
          {card.principalComment && (
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>Principal's Comment</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{card.principalComment}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReportCardView;
