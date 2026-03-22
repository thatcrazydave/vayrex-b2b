import React, { useState, useEffect } from 'react';
import API from '../../services/api';

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({
    page: 1,
    limit: 50,
    action: '',
    userId: '',
    startDate: '',
    endDate: ''
  });
  const [expandedLog, setExpandedLog] = useState(null);

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams(
        Object.entries(filters).filter(([_, v]) => v !== '')
      ).toString();
      
      const response = await API.get(`/admin/audit-logs?${params}`);
      
      if (response.data.success) {
        setLogs(response.data.data.logs);
        setPagination(response.data.data.pagination);
      } else {
        setError(response.data.error?.message || 'Failed to fetch audit logs');
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      setError(err.response?.data?.error?.message || err.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return '#dc2626';
      case 'warning': return '#f59e0b';
      case 'info': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  const getActionIcon = (action) => {
    const icons = {
      user_created: 'U',
      user_login: 'L',
      user_logout: 'O',
      user_deleted: 'D',
      user_role_changed: 'R',
      user_status_changed: 'S',
      pdf_uploaded: 'P',
      pdf_deleted: 'X',
      question_generated: 'Q',
      exam_taken: 'E',
      contact_responded: 'C',
      backup_created: 'B',
      backup_restored: 'BR',
      content_moderated: 'M',
      report_generated: 'RG',
      default: 'A'
    };
    return icons[action] || icons.default;
  };

  const formatAction = (action) => {
    return action.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const handleClearFilters = () => {
    setFilters({
      page: 1,
      limit: 50,
      action: '',
      userId: '',
      startDate: '',
      endDate: ''
    });
  };

  const handlePageChange = (newPage) => {
    setFilters(prev => ({ ...prev, page: newPage }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (error && logs.length === 0) {
    return (
      <div className="error-container">
        <div className="error-card">
          <p>{error}</p>
          <button onClick={fetchLogs} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="audit-logs">
      {/* Filters */}
      <div className="filters-section">
        <div className="filters-bar">
          <input
            type="text"
            placeholder="User ID..."
            className="search-input"
            value={filters.userId}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value, page: 1 })}
          />

          <select
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })}
            className="filter-select"
          >
            <option value="">All Actions</option>
            <option value="user_created">User Created</option>
            <option value="user_login">User Login</option>
            <option value="user_logout">User Logout</option>
            <option value="user_deleted">User Deleted</option>
            <option value="user_role_changed">Role Changed</option>
            <option value="user_status_changed">Status Changed</option>
            <option value="pdf_uploaded">PDF Uploaded</option>
            <option value="pdf_deleted">PDF Deleted</option>
            <option value="question_generated">Question Generated</option>
            <option value="exam_taken">Exam Taken</option>
            <option value="contact_responded">Contact Responded</option>
            <option value="backup_created">Backup Created</option>
            <option value="backup_restored">Backup Restored</option>
            <option value="content_moderated">Content Moderated</option>
            <option value="report_generated">Report Generated</option>
          </select>

          <input
            type="date"
            className="filter-select"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value, page: 1 })}
            placeholder="Start Date"
          />

          <input
            type="date"
            className="filter-select"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value, page: 1 })}
            placeholder="End Date"
          />

          <button onClick={fetchLogs} className="btn-primary" disabled={loading}>
            Refresh
          </button>

          {(filters.action || filters.userId || filters.startDate || filters.endDate) && (
            <button 
              onClick={handleClearFilters}
              className="btn-secondary"
              disabled={loading}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Logs List */}
      {loading ? (
        <div className="loading-card">Loading audit logs...</div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <p>No audit logs found</p>
        </div>
      ) : (
        <>
          <div className="logs-list">
            {logs.map(log => (
              <div key={log._id} className="log-card">
                <div 
                  className="log-severity"
                  style={{ backgroundColor: getSeverityColor(log.severity) }}
                />
                <div className="log-content">
                  <div className="log-header">
                    <div className="log-action">
                      <span className="log-icon">{getActionIcon(log.action)}</span>
                      <strong>{formatAction(log.action)}</strong>
                    </div>
                    <span className="log-timestamp">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="log-meta">
                    {log.userId && (
                      <span className="log-user">
                        User: {log.userId.username || log.userId.email}
                      </span>
                    )}
                    {log.ipAddress && (
                      <span className="log-ip">
                        IP: {log.ipAddress}
                      </span>
                    )}
                    {log.resourceType && (
                      <span className="log-resource">
                        Resource: {log.resourceType}
                      </span>
                    )}
                  </div>

                  {log.details && Object.keys(log.details).length > 0 && (
                    <button
                      className="log-expand-btn"
                      onClick={() => setExpandedLog(expandedLog === log._id ? null : log._id)}
                    >
                      {expandedLog === log._id ? 'Hide Details' : 'Show Details'}
                    </button>
                  )}

                  {expandedLog === log._id && log.details && (
                    <pre className="log-details">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}

                  {log.userAgent && expandedLog === log._id && (
                    <div className="log-user-agent">
                      <strong>User Agent:</strong>
                      <code>{log.userAgent}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="pagination">
            <button
              className="btn-secondary"
              disabled={pagination.currentPage === 1 || loading}
              onClick={() => handlePageChange(pagination.currentPage - 1)}
            >
              Previous
            </button>
            
            <span className="pagination-info">
              Page {pagination.currentPage} of {pagination.totalPages}
              ({pagination.totalLogs} total logs)
            </span>
            
            <button
              className="btn-secondary"
              disabled={pagination.currentPage === pagination.totalPages || loading}
              onClick={() => handlePageChange(pagination.currentPage + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLogs;