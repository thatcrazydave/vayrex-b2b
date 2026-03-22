import React, { useState, useEffect } from 'react';
import {
  FiDownload,
  FiTrash2,
  FiPlus,
  FiRefreshCw,
  FiAlertCircle,
  FiCheckCircle,
  FiClock,
  FiHardDrive,
  FiX,
  FiServer,
  FiArchive
} from 'react-icons/fi';
import API from '../../services/api';
import { showToast } from '../../utils/toast';
import ConfirmDialog from '../common/ConfirmDialog';

const BackupManager = () => {
  const [backups, setBackups] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [backupConfig, setBackupConfig] = useState({
    type: 'full',
    collections: []
  });
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    type: 'warning',
    title: '',
    message: '',
    onConfirm: () => {}
  });

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await API.get('/admin/backups');

      if (response.data) {
        const backups = response.data.data?.backups || [];
        const stats = response.data.data?.stats || { total: 0, totalSize: 0, latest: null };

        setBackups(backups);
        setStats(stats);
        
        if(backups.length === 0) {
          console.info('No backups Found. Create one to get started.');
        }

      } else {
        setError(response.data.error?.message || 'Failed to load backups');
        setBackups([]);
        setStats({ total: 0, totalSize: 0, latest: null });
      }
    } catch (err) {
      console.error('Error fetching backups:', err);
      setError(err.message || 'Failed to load backups');
      setBackups([]);
      setStats({ total: 0, totalSize: 0, latest: null });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    if (backupConfig.type === 'partial' && backupConfig.collections.length === 0) {
      showToast.warning('Please select at least one collection for partial backup');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      type: 'info',
      title: 'Create Backup',
      message: 'Create a backup? This may take a few minutes.',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          setCreating(true);
          const toastId = showToast.loading('Creating backup...');
          
          const response = await API.post('/admin/backups/create', backupConfig);
          
          showToast.update(toastId, {
            render: 'Backup created successfully!',
            type: 'success',
            autoClose: 3000
          });
          
          setShowCreateModal(false);
          setBackupConfig({ type: 'full', collections: [] });
          fetchBackups();
        } catch (err) {
          const errorMsg = err.response?.data?.error?.message || err.message || 'Failed to create backup';
          showToast.error(errorMsg);
          console.error('Backup creation error:', err);
        } finally {
          setCreating(false);
        }
      }
    });
  };

  const handleRestoreBackup = async (backupId) => {
    setConfirmDialog({
      isOpen: true,
      type: 'danger',
      title: 'WARNING: Data Restoration',
      message: 'This will replace ALL current data with the backup. This action CANNOT be undone. Are you absolutely sure?',
      confirmText: 'Yes, Restore',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          const toastId = showToast.loading('Restoring backup...');
          await API.post(`/admin/backups/${backupId}/restore`, {});
          
          showToast.update(toastId, {
            render: 'Backup restored successfully! Page will reload...',
            type: 'success',
            autoClose: 2000
          });
          
          setTimeout(() => window.location.reload(), 2000);
        } catch (err) {
          const errorMsg = err.response?.data?.error?.message || err.message || 'Failed to restore backup';
          showToast.error(errorMsg);
        }
      }
    });
  };

  const handleDeleteBackup = async (backupId) => {
    setConfirmDialog({
      isOpen: true,
      type: 'danger',
      title: 'Delete Backup',
      message: 'Delete this backup permanently? This cannot be undone.',
      confirmText: 'Yes, Delete',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          await API.delete(`/admin/backups/${backupId}`);
          showToast.success('Backup deleted successfully');
          fetchBackups();
        } catch (err) {
          const errorMsg = err.response?.data?.error?.message || err.message || 'Failed to delete backup';
          showToast.error(errorMsg);
        }
      }
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const collectionOptions = [
    { value: 'users', label: 'Users' },
    { value: 'questions', label: 'Questions' },
    { value: 'results', label: 'Results' },
    { value: 'pdfs', label: 'PDF Library' },
    { value: 'contacts', label: 'Contacts' }
  ];

  return (
    <div className="backup-manager-container">
      {/* Header */}
      <div className="backup-header">
        <div className="header-left">
          <h2>
            <FiArchive />
            <span>Backup Manager</span>
          </h2>
          <p className="header-subtitle">Create and manage database backups</p>
        </div>
        
        <div className="header-actions">
          <button
            className="refresh-btn"
            onClick={fetchBackups}
            disabled={loading}
          >
            <FiRefreshCw className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          
          <button
            className="create-btn"
            onClick={() => setShowCreateModal(true)}
          >
            <FiPlus />
            <span>Create Backup</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="backup-stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <FiServer />
            </div>
            <div className="stat-content">
              <span className="stat-label">Total Backups</span>
              <span className="stat-value">{stats.total || 0}</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FiHardDrive />
            </div>
            <div className="stat-content">
              <span className="stat-label">Total Size</span>
              <span className="stat-value">{formatFileSize(stats.totalSize || 0)}</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FiClock />
            </div>
            <div className="stat-content">
              <span className="stat-label">Latest Backup</span>
              <span className="stat-value">
                {stats.latest ? formatDate(stats.latest.startedAt) : 'None'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="backup-loading">
          <div className="loading-spinner">
            <FiRefreshCw className="spin" />
          </div>
          <p>Loading backups...</p>
        </div>
      ) : error ? (
        <div className="backup-error">
          <FiAlertCircle className="error-icon" />
          <h3>Failed to Load Backups</h3>
          <p>{error}</p>
          <button className="retry-btn" onClick={fetchBackups}>
            <FiRefreshCw />
            <span>Try Again</span>
          </button>
        </div>
      ) : backups.length === 0 ? (
        <div className="backup-empty">
          <FiArchive className="empty-icon" />
          <h3>No Backups Yet</h3>
          <p>Create your first backup to protect your data</p>
          <button 
            className="create-btn"
            onClick={() => setShowCreateModal(true)}
          >
            <FiPlus />
            <span>Create Backup</span>
          </button>
        </div>
      ) : (
        <div className="backups-list">
          {backups.map(backup => (
            <div key={backup._id} className="backup-card">
              <div className="backup-card-header">
                <div className="backup-info">
                  <div className="backup-title">
                    <span className={`type-badge ${backup.type}`}>
                      {backup.type === 'full' ? 'FULL' : 'PARTIAL'}
                    </span>
                    <h4>Backup #{backups.indexOf(backup) + 1}</h4>
                  </div>
                  <span className={`status-badge ${backup.status}`}>
                    {backup.status}
                  </span>
                </div>
              </div>

              <div className="backup-details">
                <div className="detail-item">
                  <span className="detail-label">Size</span>
                  <span className="detail-value">{formatFileSize(backup.fileSize || 0)}</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Created</span>
                  <span className="detail-value">{formatDate(backup.startedAt)}</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Created By</span>
                  <span className="detail-value">
                    {backup.initiatedBy?.username || 'System'}
                  </span>
                </div>

                {backup.collections && backup.collections.length > 0 && (
                  <div className="detail-item full-width">
                    <span className="detail-label">Collections</span>
                    <div className="collections-list">
                      {backup.collections.map((col, i) => (
                        <span key={i} className="collection-tag">{col}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="backup-actions">
                <button
                  className="action-btn restore"
                  onClick={() => handleRestoreBackup(backup._id)}
                  disabled={backup.status !== 'completed'}
                  title={backup.status !== 'completed' ? 'Backup not ready' : 'Restore this backup'}
                >
                  <FiDownload />
                  <span>Restore</span>
                </button>

                <button
                  className="action-btn delete"
                  onClick={() => handleDeleteBackup(backup._id)}
                  title="Delete this backup"
                >
                  <FiTrash2 />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Backup Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create New Backup</h2>
              <button
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                <FiX />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Backup Type</label>
                <select
                  value={backupConfig.type}
                  onChange={(e) => setBackupConfig({
                    ...backupConfig,
                    type: e.target.value,
                    collections: []
                  })}
                  className="form-select"
                  disabled={creating}
                >
                  <option value="full">Full Backup (All Data)</option>
                  <option value="partial">Partial Backup (Select Collections)</option>
                </select>
              </div>

              {backupConfig.type === 'partial' && (
                <div className="form-group">
                  <label>Select Collections</label>
                  <div className="checkbox-group">
                    {collectionOptions.map(option => (
                      <label key={option.value} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={backupConfig.collections.includes(option.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBackupConfig({
                                ...backupConfig,
                                collections: [...backupConfig.collections, option.value]
                              });
                            } else {
                              setBackupConfig({
                                ...backupConfig,
                                collections: backupConfig.collections.filter(c => c !== option.value)
                              });
                            }
                          }}
                          disabled={creating}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="info-box">
                <FiAlertCircle />
                <div>
                  <strong>Important:</strong>
                  <ul>
                    <li>Backup creation may take several minutes</li>
                    <li>System performance may be affected</li>
                    <li>Backups are stored in AWS S3</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleCreateBackup}
                disabled={creating}
              >
                {creating ? (
                  <>
                    <FiRefreshCw className="spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <FiPlus />
                    <span>Create Backup</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
        confirmText={confirmDialog.confirmText}
        loading={creating}
      />
    </div>
  );
};

export default BackupManager;