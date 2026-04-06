import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import API from '../services/api';
import { FiArrowLeft, FiSave, FiCalendar, FiClock, FiLock, FiCheck } from 'react-icons/fi';
import { showToast } from '../utils/toast';

/**
 * AttendanceMarker — Teacher-facing UI for marking student attendance.
 * Route: /attendance (per teacher sidebar)
 */
function AttendanceMarker() {
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const [assignments, setAssignments] = useState([]);
  const [selectedAssign, setSelectedAssign] = useState(null);
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState({}); // { [studentId]: { status, note } }
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [period, setPeriod] = useState('full-day');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [existingId, setExistingId] = useState(null);

  // Load teacher assignments
  useEffect(() => {
    if (!orgId) return;
    const fetchAssignments = async () => {
      try {
        const res = await API.get(`/org/${orgId}/subjects/my-assignments`);
        const list = res.data.assignments || [];
        setAssignments(list);
        if (list.length === 1) setSelectedAssign(list[0]);
      } catch { /* keep empty */ }
      setLoading(false);
    };
    fetchAssignments();
  }, [orgId]);

  // Load students + existing attendance when class or date changes
  const loadAttendance = useCallback(async () => {
    if (!orgId || !selectedAssign) return;
    const classId = selectedAssign.classroomId || selectedAssign.classId?._id || selectedAssign.classId;
    if (!classId) return;

    setLoading(true);
    setIsLocked(false);
    setExistingId(null);

    try {
      const [studentsRes, attendanceRes] = await Promise.allSettled([
        API.get(`/org/${orgId}/classrooms/${classId}/students`),
        API.get(`/org/${orgId}/attendance/${classId}/date/${date}`),
      ]);

      // Students
      const studentList = studentsRes.status === 'fulfilled'
        ? (studentsRes.value.data.students || studentsRes.value.data.members || [])
        : [];
      setStudents(studentList);

      // Existing attendance
      const attData = attendanceRes.status === 'fulfilled' ? attendanceRes.value.data : null;
      const existing = attData?.attendance || attData?.record || null;

      if (existing && existing.records?.length > 0) {
        setIsLocked(!!existing.isLocked);
        setExistingId(existing._id || null);
        if (existing.period) setPeriod(existing.period);

        // Pre-fill from existing records
        const map = {};
        existing.records.forEach(r => {
          const sid = r.studentId?._id || r.studentId;
          map[sid] = { status: r.status || 'present', note: r.note || '' };
        });
        // Also default any student not in existing records
        studentList.forEach(s => {
          const sid = s.userId || s._id;
          if (!map[sid]) map[sid] = { status: 'present', note: '' };
        });
        setRecords(map);
      } else {
        // Default all to present
        const map = {};
        studentList.forEach(s => {
          const sid = s.userId || s._id;
          map[sid] = { status: 'present', note: '' };
        });
        setRecords(map);
      }
    } catch (err) {
      showToast.error('Failed to load attendance data');
    }
    setLoading(false);
  }, [orgId, selectedAssign, date]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const setStatus = (studentId, status) => {
    if (isLocked) return;
    setRecords(prev => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || {}), status },
    }));
  };

  const setNote = (studentId, note) => {
    if (isLocked) return;
    setRecords(prev => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || {}), note },
    }));
  };

  const markAll = (status) => {
    if (isLocked) return;
    setRecords(prev => {
      const next = {};
      Object.keys(prev).forEach(sid => {
        next[sid] = { ...prev[sid], status };
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedAssign || isLocked) return;
    const classId = selectedAssign.classroomId || selectedAssign.classId?._id || selectedAssign.classId;
    const termId = selectedAssign.termId?._id || selectedAssign.termId;

    const payload = {
      classId,
      termId,
      date,
      period,
      records: Object.entries(records).map(([studentId, data]) => ({
        studentId,
        status: data.status,
        note: data.note || '',
      })),
    };

    setSaving(true);
    try {
      await API.post(`/org/${orgId}/attendance`, payload);
      showToast.success('Attendance saved successfully');
      loadAttendance();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to save attendance');
    }
    setSaving(false);
  };

  const classLabel = (a) => {
    const cls = a.classroom?.name || a.classId?.name || a.classroomId?.name || 'Class';
    const sub = a.subject?.name || a.subjectId?.name || 'Subject';
    return `${cls} — ${sub}`;
  };

  // Counts
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  Object.values(records).forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  if (loading && assignments.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Link to="/teacher" style={{ color: '#0a0a0a' }}><FiArrowLeft size={18} /></Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Mark Attendance</h1>
        {isLocked && (
          <span style={lockedBadge}><FiLock size={12} /> Locked</span>
        )}
      </div>
      <p style={{ color: '#6b7280', marginBottom: '1.5rem', fontSize: 14 }}>
        Record student attendance for a class session.
      </p>

      {/* Controls row */}
      <div style={controlsRow}>
        {/* Class selector */}
        <div style={controlGroup}>
          <label style={labelStyle}>Class</label>
          {assignments.length === 0 ? (
            <div style={{ fontSize: 14, color: '#6b7280' }}>No assignments found</div>
          ) : assignments.length === 1 ? (
            <div style={{ fontSize: 14, fontWeight: 600 }}>{classLabel(assignments[0])}</div>
          ) : (
            <select
              style={selectStyle}
              value={selectedAssign?._id || ''}
              onChange={e => setSelectedAssign(assignments.find(a => a._id === e.target.value) || null)}
            >
              <option value="">Select a class...</option>
              {assignments.map(a => (
                <option key={a._id} value={a._id}>{classLabel(a)}</option>
              ))}
            </select>
          )}
        </div>

        {/* Date picker */}
        <div style={controlGroup}>
          <label style={labelStyle}><FiCalendar size={13} style={{ marginRight: 4 }} />Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={selectStyle}
            disabled={isLocked}
          />
        </div>

        {/* Period selector */}
        <div style={controlGroup}>
          <label style={labelStyle}><FiClock size={13} style={{ marginRight: 4 }} />Period</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={selectStyle}
            disabled={isLocked}
          >
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="full-day">Full Day</option>
          </select>
        </div>
      </div>

      {/* Summary counts */}
      {selectedAssign && students.length > 0 && (
        <div style={summaryRow}>
          <span style={{ ...countBadge, background: '#dcfce7', color: '#166534' }}>Present: {counts.present}</span>
          <span style={{ ...countBadge, background: '#fee2e2', color: '#991b1b' }}>Absent: {counts.absent}</span>
          <span style={{ ...countBadge, background: '#ffedd5', color: '#9a3412' }}>Late: {counts.late}</span>
          <span style={{ ...countBadge, background: '#dbeafe', color: '#1e40af' }}>Excused: {counts.excused}</span>
          <span style={{ fontSize: 13, color: '#6b7280', marginLeft: 'auto' }}>Total: {students.length}</span>
        </div>
      )}

      {/* Quick mark all */}
      {selectedAssign && students.length > 0 && !isLocked && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#6b7280', alignSelf: 'center', marginRight: 4 }}>Mark all:</span>
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => markAll(opt.value)}
              style={{ ...markAllBtn, borderColor: opt.color, color: opt.color }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Student table */}
      {!selectedAssign ? (
        <div style={emptyState}>Select a class to begin marking attendance.</div>
      ) : loading ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading students...</div>
      ) : students.length === 0 ? (
        <div style={emptyState}>No students enrolled in this class.</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ ...thStyle, minWidth: 140 }}>#</th>
                  <th style={{ ...thStyle, minWidth: 160 }}>Student</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: 280 }}>Status</th>
                  <th style={{ ...thStyle, minWidth: 140 }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, idx) => {
                  const sid = s.userId || s._id;
                  const rec = records[sid] || { status: 'present', note: '' };

                  return (
                    <tr key={sid} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdStyle}>{idx + 1}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {s.fullName || s.fullname || s.name || s.email || 'Student'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <div style={statusBtnGroup}>
                          {STATUS_OPTIONS.map(opt => {
                            const active = rec.status === opt.value;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => setStatus(sid, opt.value)}
                                disabled={isLocked}
                                style={{
                                  ...statusBtn,
                                  background: active ? opt.color : '#fff',
                                  color: active ? '#fff' : opt.color,
                                  borderColor: opt.color,
                                  opacity: isLocked ? 0.6 : 1,
                                  cursor: isLocked ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {active && <FiCheck size={12} />}
                                <span style={{ fontSize: 12 }}>{opt.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          placeholder="Optional note"
                          value={rec.note}
                          onChange={e => setNote(sid, e.target.value)}
                          disabled={isLocked}
                          style={noteInput}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Save button */}
          {!isLocked && (
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleSave} disabled={saving} style={btnPrimary}>
                <FiSave size={14} />
                {saving ? 'Saving...' : existingId ? 'Update Attendance' : 'Save Attendance'}
              </button>
            </div>
          )}

          {isLocked && (
            <div style={lockedBanner}>
              <FiLock size={14} />
              This attendance record is locked and cannot be edited.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Status options */
const STATUS_OPTIONS = [
  { value: 'present', label: 'Present', color: '#16a34a' },
  { value: 'absent', label: 'Absent', color: '#dc2626' },
  { value: 'late', label: 'Late', color: '#ea580c' },
  { value: 'excused', label: 'Excused', color: '#2563eb' },
];

/* Style constants */
const controlsRow = {
  display: 'flex',
  gap: 16,
  marginBottom: 20,
  flexWrap: 'wrap',
  background: '#f9fafb',
  borderRadius: 10,
  padding: '16px 20px',
};

const controlGroup = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160, flex: 1 };

const labelStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  display: 'flex',
  alignItems: 'center',
};

const selectStyle = {
  padding: '8px 12px',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 14,
  background: '#fff',
  fontWeight: 500,
};

const summaryRow = {
  display: 'flex',
  gap: 8,
  marginBottom: 16,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const countBadge = {
  fontSize: 12,
  fontWeight: 700,
  padding: '4px 12px',
  borderRadius: 20,
};

const statusBtnGroup = {
  display: 'inline-flex',
  gap: 4,
  flexWrap: 'wrap',
  justifyContent: 'center',
};

const statusBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '5px 10px',
  border: '1.5px solid',
  borderRadius: 6,
  fontWeight: 600,
  fontSize: 12,
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};

const markAllBtn = {
  padding: '4px 10px',
  border: '1px solid',
  borderRadius: 6,
  background: '#fff',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
};

const noteInput = {
  width: '100%',
  padding: '5px 8px',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontSize: 13,
  minWidth: 100,
};

const btnPrimary = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 20px',
  background: '#0a0a0a',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: '#6b7280' };
const tdStyle = { padding: '10px 12px' };
const emptyState = { background: '#f9fafb', borderRadius: 10, padding: 40, textAlign: 'center', color: '#6b7280' };

const lockedBadge = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  fontWeight: 700,
  padding: '3px 10px',
  borderRadius: 20,
  background: '#fef3c7',
  color: '#92400e',
};

const lockedBanner = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 24,
  padding: '12px 16px',
  background: '#fef3c7',
  borderRadius: 8,
  color: '#92400e',
  fontSize: 14,
  fontWeight: 500,
};

export default AttendanceMarker;
