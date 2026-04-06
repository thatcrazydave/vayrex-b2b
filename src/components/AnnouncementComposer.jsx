import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { toast } from 'react-toastify';
import {
  FiSend, FiTrash2, FiChevronDown, FiPlus, FiList, FiBell
} from 'react-icons/fi';

/**
 * AnnouncementComposer — Create + list announcements
 * Route: /org-admin/announcements or /teacher/announcements
 *
 * Admin: school, class, teacher-broadcast, user scopes
 * Teacher: class or teacher-broadcast scope only
 */
function AnnouncementComposer() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const isAdmin = ['owner', 'org_admin'].includes(user?.orgRole);

  const [tab, setTab] = useState('create'); // 'create' | 'list'
  const [announcements, setAnnouncements] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [scope, setScope] = useState(isAdmin ? 'school' : 'class');
  const [targetClassIds, setTargetClassIds] = useState([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!orgId) return;
    loadClasses();
    loadAnnouncements();
  }, [orgId]);

  async function loadClasses() {
    try {
      const res = await API.get(`/org/${orgId}/classrooms`);
      setClasses(res.data?.classrooms || []);
    } catch (_) { /* keep empty */ }
  }

  async function loadAnnouncements() {
    setLoading(true);
    try {
      const res = await API.get(`/org/${orgId}/announcements?limit=50`);
      setAnnouncements(res.data?.announcements || []);
    } catch (_) { /* keep empty */ }
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (scope === 'class' && targetClassIds.length === 0) {
      toast.error('Select at least one class');
      return;
    }

    setSubmitting(true);
    try {
      const payload = { scope, title: title.trim(), body: body.trim() };
      if (scope === 'class') payload.targetClassIds = targetClassIds;

      await API.post(`/org/${orgId}/announcements`, payload);
      toast.success('Announcement created');
      setTitle('');
      setBody('');
      setTargetClassIds([]);
      loadAnnouncements();
      setTab('list');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to create announcement');
    }
    setSubmitting(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await API.delete(`/org/${orgId}/announcements/${id}`);
      toast.success('Announcement deleted');
      setAnnouncements((prev) => prev.filter((a) => a._id !== id));
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to delete');
    }
  }

  function toggleClass(classId) {
    setTargetClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  }

  const scopes = isAdmin
    ? [
        { value: 'school', label: 'Whole School' },
        { value: 'class', label: 'Specific Classes' },
        { value: 'teacher-broadcast', label: 'All Teachers' },
      ]
    : [
        { value: 'class', label: 'My Classes' },
        { value: 'teacher-broadcast', label: 'All Teachers' },
      ];

  return (
    <div className="dashboard-page" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FiBell size={22} /> Announcements
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Create and manage school announcements.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          className={tab === 'create' ? 'btn btn-primary' : 'btn btn-outline'}
          onClick={() => setTab('create')}
          style={{ gap: '6px', display: 'inline-flex', alignItems: 'center' }}
        >
          <FiPlus size={14} /> Create
        </button>
        <button
          className={tab === 'list' ? 'btn btn-primary' : 'btn btn-outline'}
          onClick={() => setTab('list')}
          style={{ gap: '6px', display: 'inline-flex', alignItems: 'center' }}
        >
          <FiList size={14} /> My Announcements
        </button>
      </div>

      {tab === 'create' && (
        <form onSubmit={handleCreate} style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem' }}>
          {/* Scope */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Audience</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}
            >
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Class picker */}
          {scope === 'class' && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Select Classes</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {classes.map((c) => (
                  <button
                    type="button"
                    key={c._id}
                    onClick={() => toggleClass(c._id)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${targetClassIds.includes(c._id) ? 'var(--primary)' : 'var(--border)'}`,
                      background: targetClassIds.includes(c._id) ? 'var(--primary)' : 'transparent',
                      color: targetClassIds.includes(c._id) ? '#fff' : 'inherit',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    {c.name}
                  </button>
                ))}
                {classes.length === 0 && <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No classes found</span>}
              </div>
            </div>
          )}

          {/* Title */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title"
              maxLength={200}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem' }}
            />
          </div>

          {/* Body */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Message (optional)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              rows={4}
              maxLength={2000}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.9rem', resize: 'vertical' }}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ gap: '6px', display: 'inline-flex', alignItems: 'center' }}>
            <FiSend size={14} /> {submitting ? 'Sending...' : 'Send Announcement'}
          </button>
        </form>
      )}

      {tab === 'list' && (
        <div>
          {loading ? (
            <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading...
            </div>
          ) : announcements.length === 0 ? (
            <div style={{ background: 'var(--background-light)', borderRadius: 'var(--radius-md)', padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No announcements yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {announcements.map((a) => (
                <div key={a._id} style={{
                  background: 'var(--background-light)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem 1.25rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{a.title}</div>
                      {a.body && <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{a.body}</div>}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {a.scope} · {a.createdBy?.fullname || a.createdBy?.name || 'Unknown'} · {new Date(a.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    {(isAdmin || a.createdBy?._id === user?.id) && (
                      <button
                        onClick={() => handleDelete(a._id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.25rem' }}
                        title="Delete"
                      >
                        <FiTrash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AnnouncementComposer;
