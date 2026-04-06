/**
 * StudentAssignmentView — Student reads and submits an assignment
 * Route: /student/assignments/:id
 */
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { FiArrowLeft, FiSend, FiCheckCircle, FiClock, FiBook } from 'react-icons/fi';
import { showToast } from '../utils/toast';

function StudentAssignmentView() {
  const { id } = useParams();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const navigate = useNavigate();

  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!orgId || !id) return;
    const load = async () => {
      try {
        const res = await API.get(`/org/${orgId}/assignments/${id}`);
        const asgn = res.data.assignment;
        setAssignment(asgn);
        if (asgn.mySubmission) {
          setSubmitted(true);
          setAnswer(asgn.mySubmission.answers?.[0]?.answer || '');
        }
      } catch (err) {
        showToast.error('Assignment not found or not available.');
        navigate('/student');
      }
      setLoading(false);
    };
    load();
  }, [orgId, id, navigate]);

  const isPastDue = assignment?.dueDate && new Date() > new Date(assignment.dueDate);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!answer.trim()) return showToast.error('Please write your answer before submitting.');
    if (isPastDue) return showToast.error('This assignment is past its due date.');

    setSubmitting(true);
    try {
      const csrf = await API.get('/csrf-token');
      await API.post(
        `/org/${orgId}/assignments/${id}/submit`,
        { answers: [{ answer: answer.trim() }] },
        { headers: { 'X-CSRF-Token': csrf.data.csrfToken } }
      );
      setSubmitted(true);
      showToast.success('Assignment submitted successfully!');
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to submit assignment.';
      if (msg.toLowerCase().includes('already')) {
        setSubmitted(true);
        showToast.info('You have already submitted this assignment.');
      } else {
        showToast.error(msg);
      }
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '4rem 1.5rem', textAlign: 'center', color: '#6b7280' }}>
        Loading assignment...
      </div>
    );
  }

  if (!assignment) return null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Back link */}
      <Link to="/student" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 14, marginBottom: '1.5rem', textDecoration: 'none', fontWeight: 500 }}>
        <FiArrowLeft size={14} /> Back to Dashboard
      </Link>

      {/* Assignment header card */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '2rem', marginBottom: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, #1e293b, #475569)' }} />
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
                <FiBook size={18} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {assignment.subjectId?.name || 'Subject'} · {assignment.classId?.name || 'Class'}
                </div>
              </div>
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#0f172a' }}>
              {assignment.title}
            </h1>
            {assignment.description && (
              <p style={{ fontSize: '0.95rem', color: '#475569', margin: '0 0 1rem 0', lineHeight: 1.7 }}>
                {assignment.description}
              </p>
            )}
          </div>
        </div>

        {/* Meta info bar */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', paddingTop: '1rem', borderTop: '1px solid #f1f5f9', marginTop: '0.5rem' }}>
          {assignment.dueDate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: isPastDue ? '#dc2626' : '#6b7280', fontWeight: 500 }}>
              <FiClock size={14} />
              Due: {new Date(assignment.dueDate).toLocaleString()}
              {isPastDue && <span style={{ fontSize: 11, background: '#fee2e2', color: '#dc2626', padding: '1px 8px', borderRadius: 20, fontWeight: 700 }}>PAST DUE</span>}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#6b7280', fontWeight: 500 }}>
            Max Score: <strong>{assignment.maxScore || 100}</strong>
          </div>
        </div>
      </div>

      {/* Score Badge (if graded) */}
      {assignment.mySubmission?.status === 'graded' && (
        <div style={{ 
          background: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)', 
          color: '#fff', 
          padding: '1.25rem 2rem', 
          borderRadius: 16, 
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
        }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Alignment Grade</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{assignment.mySubmission.totalScore} / {assignment.maxScore}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Status</div>
            <div style={{ background: '#10b981', color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>GRADED</div>
          </div>
        </div>
      )}

      {/* Submission section */}
      {(submitted || assignment.mySubmission) ? (
        <div>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Your Submitted Answer
              </label>
              <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>READ ONLY</span>
            </div>
            <div style={{
              width: '100%',
              padding: '1rem',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              fontSize: 15,
              lineHeight: 1.7,
              color: '#64748b',
              background: '#f8fafc',
              whiteSpace: 'pre-wrap',
              minHeight: '200px'
            }}>
              {answer}
            </div>
          </div>
          
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#059669', fontWeight: 600, fontSize: 14 }}>
              <FiCheckCircle /> Assignment Submitted
            </div>
          </div>
        </div>
      ) : isPastDue ? (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 16, padding: '2rem', textAlign: 'center', color: '#9a3412' }}>
          <FiClock size={32} style={{ marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Submission Closed</h2>
          <p style={{ margin: 0, fontSize: '0.95rem' }}>The deadline for this assignment has passed. Contact your teacher if you believe this is an error.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Your Answer
            </label>
            <textarea
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder="Write your response here..."
              rows={10}
              required
              style={{
                width: '100%',
                padding: '1rem',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                fontSize: 15,
                lineHeight: 1.7,
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                color: '#1e293b',
                background: '#f8fafc',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Link to="/student" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.75rem 1.25rem', border: '1px solid #e2e8f0', borderRadius: 10, color: '#475569', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.75rem 1.5rem', background: submitting ? '#94a3b8' : '#0f172a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              <FiSend size={14} />
              {submitting ? 'Submitting…' : 'Submit Assignment'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default StudentAssignmentView;
