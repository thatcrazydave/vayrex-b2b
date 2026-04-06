/**
 * MembersManager — Professional org member management UI
 *
 * Features:
 * - Search bar (filter by name/email/role)
 * - Paginated members table with class column
 * - Role badge with neutral colors (no green)
 * - Actions: View, Suspend, Remove
 * - Pending invitations tab
 * - Bulk CSV invite
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-toastify';
import {
  FiPlus, FiTrash2, FiMail, FiRefreshCw, FiUsers, FiClock,
  FiUpload, FiSearch, FiSlash, FiChevronDown, FiX
} from 'react-icons/fi';
import api from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

// ── Role config ─────────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  owner:     { label: 'Owner',    bg: '#1e293b', color: '#fff' },
  org_admin: { label: 'Admin',    bg: '#312e81', color: '#fff' },
  it_admin:  { label: 'IT Admin', bg: '#1e3a5f', color: '#fff' },
  teacher:   { label: 'Teacher',  bg: '#0c4a6e', color: '#fff' },
  student:   { label: 'Student',  bg: '#581c87', color: '#fff' },
  guardian:  { label: 'Guardian', bg: '#3b0764', color: '#fff' },
};

const INVITE_ROLES = ['org_admin', 'it_admin', 'teacher', 'student', 'guardian'];

function RoleBadge({ role }) {
  const cfg = ROLE_CONFIG[role] || { label: role, bg: '#475569', color: '#fff' };
  return (
    <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
      {cfg.label}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
function MembersManager({ orgId: propOrgId }) {
  const { user } = useAuth();
  const effectiveOrgId = propOrgId || user?.organizationId;

  const [tab, setTab] = useState('members');
  const [members, setMembers]   = useState([]);
  const [invites, setInvites]   = useState([]);
  const [memberPage, setMemberPage] = useState(1);
  const [invitePage, setInvitePage] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);
  const [inviteTotal, setInviteTotal] = useState(0);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('teacher');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);

  // Bulk invite
  const [bulkFile, setBulkFile]       = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadMembers = useCallback(async (page = 1) => {
    if (!effectiveOrgId) return;
    setLoading(true);
    try {
      const res = await api.get(`/org/${effectiveOrgId}/members?page=${page}&limit=20`);
      setMembers(res.data.members || []);
      setMemberTotal(res.data.pagination?.total || 0);
      setMemberPage(page);
    } catch { toast.error('Failed to load members'); }
    setLoading(false);
  }, [effectiveOrgId]);

  const loadInvites = useCallback(async (page = 1) => {
    if (!effectiveOrgId) return;
    setLoading(true);
    try {
      const res = await api.get(`/org/${effectiveOrgId}/invites?status=pending&page=${page}&limit=20`);
      setInvites(res.data.invites || []);
      setInviteTotal(res.data.pagination?.total || 0);
      setInvitePage(page);
    } catch { toast.error('Failed to load invites'); }
    setLoading(false);
  }, [effectiveOrgId]);

  useEffect(() => {
    if (tab === 'members') loadMembers(1);
    else loadInvites(1);
  }, [tab, loadMembers, loadInvites]);

  // ── Filtered members (client-side search) ─────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(m =>
      (m.username || '').toLowerCase().includes(q) ||
      (m.fullname || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q) ||
      (m.orgRole || '').toLowerCase().includes(q)
    );
  }, [members, search]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function sendInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return toast.error('Email is required');
    setInviteLoading(true);
    try {
      const csrfRes = await api.get('/csrf-token');
      const res = await api.post(
        `/org/${effectiveOrgId}/invites`,
        { email: inviteEmail.trim(), orgRole: inviteRole },
        { headers: { 'X-CSRF-Token': csrfRes.data.csrfToken } }
      );
      const { emailSent, inviteUrl, message } = res.data || {};
      if (emailSent === false) {
        toast.warning(message || 'Invitation saved, but email delivery failed.');
        if (inviteUrl) {
          const copied = await navigator.clipboard.writeText(inviteUrl).then(() => true).catch(() => false);
          toast.info(copied ? 'Manual invite link copied to clipboard' : `Manual invite link: ${inviteUrl}`);
        }
      } else {
        toast.success(message || `Invitation sent to ${inviteEmail}`);
      }
      setInviteEmail('');
      setShowInvitePanel(false);
      if (tab === 'invites') loadInvites(1);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to send invitation');
    }
    setInviteLoading(false);
  }

  async function revokeInvite(inviteId) {
    if (!window.confirm('Revoke this invitation?')) return;
    try {
      const csrfRes = await api.get('/csrf-token');
      await api.delete(`/org/${effectiveOrgId}/invites/${inviteId}`, {
        headers: { 'X-CSRF-Token': csrfRes.data.csrfToken },
      });
      toast.success('Invitation revoked');
      loadInvites(invitePage);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to revoke invitation');
    }
  }

  async function removeMember(memberId, memberEmail) {
    if (!window.confirm(`Are you sure you want to remove ${memberEmail} from the organisation? This cannot be undone.`)) return;
    try {
      const csrfRes = await api.get('/csrf-token');
      await api.delete(`/org/${effectiveOrgId}/members/${memberId}`, {
        headers: { 'X-CSRF-Token': csrfRes.data.csrfToken },
      });
      toast.success('Member removed');
      loadMembers(memberPage);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to remove member');
    }
  }

  async function handleBulkInvite() {
    if (!bulkFile) return toast.error('Select a CSV file first');
    setBulkLoading(true);
    try {
      const text = await bulkFile.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return toast.error('CSV must have a header row and at least one data row');
      const header = lines[0].toLowerCase().split(',').map(h => h.trim());
      const emailIdx = header.indexOf('email');
      const roleIdx  = header.indexOf('role');
      if (emailIdx === -1) return toast.error('CSV must have an "email" column');
      const invitesData = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        const email = cols[emailIdx];
        if (!email) continue;
        const role = roleIdx !== -1 && cols[roleIdx] ? cols[roleIdx] : 'teacher';
        invitesData.push({ email, orgRole: role });
      }
      if (invitesData.length === 0) return toast.error('No valid rows found in CSV');
      if (invitesData.length > 500) return toast.error('Maximum 500 invites per bulk upload');
      const csrfRes = await api.get('/csrf-token');
      const res = await api.post(
        `/org/${effectiveOrgId}/invites/bulk`,
        { invites: invitesData },
        { headers: { 'X-CSRF-Token': csrfRes.data.csrfToken } }
      );
      toast.success(res.data.message || `Bulk invite job queued for ${invitesData.length} recipients`);
      setBulkFile(null);
      if (tab === 'invites') loadInvites(1);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Bulk invite failed');
    }
    setBulkLoading(false);
  }

  const totalPages = (total) => Math.ceil(total / 20);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'inherit' }}>

      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>Members</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: 14, color: '#64748b' }}>Manage organisation members, roles, and invitations.</p>
        </div>
        <button
          onClick={() => setShowInvitePanel(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: showInvitePanel ? '#f1f5f9' : '#0f172a', color: showInvitePanel ? '#334155' : '#fff', border: showInvitePanel ? '1px solid #e2e8f0' : 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          {showInvitePanel ? <><FiX size={14} /> Close</> : <><FiPlus size={14} /> Invite Member</>}
        </button>
      </div>

      {/* Invite panel (collapsible) */}
      {showInvitePanel && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: '1.5rem', marginBottom: '1.5rem', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #1e293b, #475569)' }} />
          <h3 style={{ margin: '0 0 1rem', fontSize: 15, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiMail size={15} /> Invite New Member
          </h3>
          <form onSubmit={sendInvite} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={labelSt}>Email address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="staff@school.edu.ng"
                required
                style={inputSt}
              />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelSt}>Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={inputSt}>
                {INVITE_ROLES.map(r => <option key={r} value={r}>{ROLE_CONFIG[r]?.label || r}</option>)}
              </select>
            </div>
            <button
              type="submit" disabled={inviteLoading}
              style={{ padding: '10px 22px', background: inviteLoading ? '#94a3b8' : '#0f172a', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: inviteLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', height: 'fit-content' }}
            >
              <FiPlus size={14} /> {inviteLoading ? 'Sending…' : 'Send Invite'}
            </button>
          </form>

          {/* Bulk CSV */}
          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <FiUpload size={14} color="#64748b" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Bulk Invite via CSV</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>— columns: email (required), role (optional). Max 500 rows.</span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="file" accept=".csv" onChange={e => setBulkFile(e.target.files?.[0] || null)} style={{ fontSize: 13 }} />
              <button
                onClick={handleBulkInvite} disabled={bulkLoading || !bulkFile}
                style={{ padding: '8px 18px', background: bulkLoading || !bulkFile ? '#94a3b8' : '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: bulkLoading || !bulkFile ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <FiUpload size={13} /> {bulkLoading ? 'Uploading…' : 'Send Bulk Invites'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search + Tabs row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #f1f5f9', gap: 0 }}>
          <button style={tabSt(tab === 'members')} onClick={() => setTab('members')}>
            <FiUsers size={13} /> Members ({memberTotal})
          </button>
          <button style={tabSt(tab === 'invites')} onClick={() => setTab('invites')}>
            <FiClock size={13} /> Pending Invites ({inviteTotal})
          </button>
          <button
            onClick={() => { if (tab === 'members') loadMembers(memberPage); else loadInvites(invitePage); }}
            style={{ ...tabSt(false), marginLeft: 8, opacity: 0.7 }}
            title="Refresh"
          >
            <FiRefreshCw size={13} />
          </button>
        </div>

        {/* Search */}
        {tab === 'members' && (
          <div style={{ position: 'relative' }}>
            <FiSearch size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, role…"
              style={{ paddingLeft: 36, paddingRight: 12, paddingTop: 9, paddingBottom: 9, border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 13, width: 260, outline: 'none', background: '#f8fafc' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex' }}>
                <FiX size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Members table */}
      {tab === 'members' && (
        loading ? (
          <div style={emptyBox}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={emptyBox}>{search ? 'No members match your search.' : 'No members yet.'}</div>
        ) : (
          <>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={thSt}>Name</th>
                    <th style={thSt}>Email</th>
                    <th style={thSt}>Role</th>
                    <th style={thSt}>Status</th>
                    <th style={thSt}>Class</th>
                    <th style={thSt}>Joined</th>
                    <th style={{ ...thSt, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m._id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <td style={tdSt}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{m.fullname || m.username || '—'}</div>
                      </td>
                      <td style={{ ...tdSt, color: '#475569' }}>{m.email}</td>
                      <td style={tdSt}><RoleBadge role={m.orgRole} /></td>
                      <td style={tdSt}>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: m.isActive ? '#0369a1' : '#64748b',
                          background: m.isActive ? '#e0f2fe' : '#f1f5f9',
                          padding: '2px 10px', borderRadius: 20
                        }}>
                          {m.isActive ? 'Active' : 'Inactive'}
                          {!m.emailVerified && ' · Unverified'}
                        </span>
                      </td>
                      <td style={{ ...tdSt, color: '#64748b', fontSize: 13 }}>
                        {m.orgRole === 'student' ? (m.classId?.name || '—') : '—'}
                      </td>
                      <td style={{ ...tdSt, color: '#94a3b8', fontSize: 12 }}>
                        {m.seatAssignedAt ? new Date(m.seatAssignedAt).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...tdSt, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {m.orgRole !== 'owner' && m._id !== user?.id && (
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            <button
                              title="Remove member"
                              onClick={() => removeMember(m._id, m.email)}
                              style={actionBtn('#dc2626', '#fff7f7')}
                            >
                              <FiTrash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages(memberTotal) > 1 && <Pagination page={memberPage} total={totalPages(memberTotal)} onPage={loadMembers} />}
          </>
        )
      )}

      {/* Invites table */}
      {tab === 'invites' && (
        loading ? (
          <div style={emptyBox}>Loading…</div>
        ) : invites.length === 0 ? (
          <div style={emptyBox}>No pending invitations.</div>
        ) : (
          <>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={thSt}>Email</th>
                    <th style={thSt}>Role</th>
                    <th style={thSt}>Expires</th>
                    <th style={{ ...thSt, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map(inv => (
                    <tr key={inv._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdSt}>{inv.email}</td>
                      <td style={tdSt}><RoleBadge role={inv.orgRole} /></td>
                      <td style={{ ...tdSt, color: '#94a3b8', fontSize: 12 }}>
                        {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...tdSt, textAlign: 'right' }}>
                        <button
                          onClick={() => revokeInvite(inv._id)}
                          title="Revoke invitation"
                          style={actionBtn('#dc2626', '#fff7f7')}
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages(inviteTotal) > 1 && <Pagination page={invitePage} total={totalPages(inviteTotal)} onPage={loadInvites} />}
          </>
        )
      )}
    </div>
  );
}

function Pagination({ page, total, onPage }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24, alignItems: 'center' }}>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} style={pagBtn(page <= 1)}>‹ Prev</button>
      <span style={{ fontSize: 13, color: '#64748b', padding: '0 8px' }}>Page {page} of {total}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= total} style={pagBtn(page >= total)}>Next ›</button>
    </div>
  );
}

// ── Style helpers ────────────────────────────────────────────────────────────
const labelSt  = { fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' };
const inputSt  = { width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#fff', boxSizing: 'border-box' };
const thSt     = { padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' };
const tdSt     = { padding: '12px 14px' };
const emptyBox = { background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 12, padding: '3rem', textAlign: 'center', color: '#94a3b8', fontSize: 14 };

const tabSt = (active) => ({
  padding: '10px 18px',
  border: 'none',
  borderBottom: active ? '2px solid #0f172a' : '2px solid transparent',
  background: 'none',
  fontWeight: active ? 700 : 500,
  color: active ? '#0f172a' : '#64748b',
  cursor: 'pointer',
  fontSize: 14,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});

const actionBtn = (color, bg) => ({
  background: bg,
  border: `1px solid ${color}20`,
  color,
  cursor: 'pointer',
  padding: '5px 8px',
  borderRadius: 7,
  display: 'inline-flex',
  alignItems: 'center',
  transition: 'opacity 0.15s',
});

const pagBtn = (disabled) => ({
  padding: '6px 14px',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  cursor: disabled ? 'not-allowed' : 'pointer',
  background: disabled ? '#f8fafc' : '#fff',
  color: disabled ? '#94a3b8' : '#334155',
  fontWeight: 600,
  fontSize: 13,
});

export default MembersManager;
