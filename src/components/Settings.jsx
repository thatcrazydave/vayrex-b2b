import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import API, { exportPDF } from '../services/api.js';
import '../styles/settings.css';
import { FiUser, FiDownload, FiShield, FiEye, FiEyeOff } from 'react-icons/fi';
import { showToast } from '../utils/toast';
import ConfirmDialog from './common/ConfirmDialog';

const Settings = () => {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [deleteAccountModal, setDeleteAccountModal] = useState(false);
  const [deleteOtp, setDeleteOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    type: 'warning',
    title: '',
    message: '',
    onConfirm: () => {}
  });

  // Profile settings
  const [profileData, setProfileData] = useState({
    fullname: '',
    username: '',
    email: '',
    defaultDifficulty: 'medium'
  });

  useEffect(() => {
    if (user) {
      setProfileData({
        fullname: user.fullname || '',
        username: user.username || '',
        email: user.email || '',
        defaultDifficulty: user.preferences?.defaultDifficulty || 'medium'
      });
    }
  }, [user]);

  const showMessage = (text, type = 'success') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 3000);
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await API.put('/user/profile', profileData);
      
      //   Update user in context
      if (updateUser) {
        updateUser(response.data.data.user);
      }
      
      showMessage('Profile updated successfully!');
    } catch (error) {
      console.error('Profile update error:', error);
      const errorMessage = error.response?.data?.error?.message || error.response?.data?.error || 'Failed to update profile. Please try again.';
      showMessage(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const passwordData = {
      currentPassword: formData.get('currentPassword'),
      newPassword: formData.get('newPassword'),
      confirmPassword: formData.get('confirmPassword')
    };

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      showMessage('New passwords do not match.', 'error');
      return;
    }

    if (passwordData.newPassword.length < 8) {
      showMessage('Password must be at least 8 characters.', 'error');
      return;
    }

    setLoading(true);

    try {
      const response = await API.put('/user/password', passwordData);
      showMessage(response.data.message || 'Password changed successfully!');
      e.target.reset();
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    } catch (error) {
      console.error('Password change error:', error);
      showMessage(
        error.response?.data?.error || 'Failed to change password. Please try again.', 
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDataExport = async (format = 'pdf') => {
    setLoading(true);

    try {
      if (format === 'pdf') {
        // Export all questions as PDF
        const response = await API.get('/user/export-data');
        const topics = response.data?.data?.uploads?.map(u => u.topic) || [];
        
        if (topics.length === 0) {
          showMessage('No questions to export. Upload some files first.', 'error');
          return;
        }
        
        for (const topic of topics) {
          await exportPDF(topic, {
            includeAnswers: true,
            format: 'questions',
            filename: `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_questions.pdf`
          });
        }
        showMessage(`Exported ${topics.length} PDF file(s) successfully!`);
      } else {
        const response = await API.get('/user/export-data');
        const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `study-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showMessage('Data exported successfully!');
      }
    } catch (error) {
      console.error('Data export error:', error);
      showMessage('Failed to export data. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAccountDeletion = () => {
    setDeleteAccountModal(true);
    setDeleteOtp('');
    setOtpSent(false);
  };

  const requestDeleteOtp = async () => {
    setOtpLoading(true);
    try {
      const response = await API.post('/user/request-delete-otp');
      if (response.data.success) {
        showMessage('OTP sent to your email. Please check your inbox.', 'success');
        setOtpSent(true);
      }
    } catch (error) {
      console.error('OTP request error:', error);
      showMessage(
        error.response?.data?.error?.message || 'Failed to send OTP. Please try again.',
        'error'
      );
    } finally {
      setOtpLoading(false);
    }
  };

  const confirmAccountDeletion = async () => {
    if (!deleteOtp || deleteOtp.length !== 6) {
      showMessage('Please enter a valid 6-digit OTP code', 'error');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      type: 'danger',
      title: 'PERMANENT ACCOUNT DELETION',
      message: 'Are you absolutely sure? This will permanently delete ALL your data. This action CANNOT be undone.',
      confirmText: 'Yes, Delete Everything',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        setLoading(true);

        try {
          await API.delete('/user/account', { data: { otp: deleteOtp } });
          showToast.success('Account deleted successfully. Redirecting...');
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        } catch (error) {
          console.error('Account deletion error:', error);
          showMessage(
            error.response?.data?.error?.message || 'Failed to delete account. Please try again.',
            'error'
          );
        } finally {
          setLoading(false);
        }
      }
    });
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Manage your account and preferences</p>
      </div>

      {message && (
        <div className={`message ${messageType}`}>
          {message}
        </div>
      )}

      <div className="settings-container">
        <div className="settings-sidebar">
          <nav className="settings-nav">
            <button 
              className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveTab('profile')}
            >
              <FiUser/>Profile
            </button>
            <button 
              className={`nav-item ${activeTab === 'security' ? 'active' : ''}`}
              onClick={() => setActiveTab('security')}
            >
              <FiShield/>
              Security
            </button>
            <button 
              className={`nav-item ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              <FiDownload/> Data & Export
            </button>
          </nav>
        </div>

        <div className="settings-content">
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="settings-section">
              <h2>Profile Information</h2>
              <form onSubmit={handleProfileUpdate} noValidate autoComplete="off">
                <div className="form-group">
                  <label htmlFor="fullname">Full Name</label>
                  <input
                    type="text"
                    id="fullname"
                    value={profileData.fullname}
                    onChange={(e) => setProfileData({...profileData, fullname: e.target.value})}
                    required
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="username">Username</label>
                  <input
                    type="text"
                    id="username"
                    value={profileData.username}
                    onChange={(e) => setProfileData({...profileData, username: e.target.value})}
                    required
                    placeholder="Enter your username"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    type="email"
                    id="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData({...profileData, email: e.target.value})}
                    required
                    placeholder="Enter your email"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="defaultDifficulty">Default Question Difficulty</label>
                  <select
                    id="defaultDifficulty"
                    value={profileData.defaultDifficulty}
                    onChange={(e) => setProfileData({...profileData, defaultDifficulty: e.target.value})}
                  >
                    <option value="easy">Easy - Basic Concepts</option>
                    <option value="medium">Medium - Application</option>
                    <option value="hard">Hard - Advanced Analysis</option>
                  </select>
                  <small>This will be used when generating questions from notes</small>
                </div>
                <div className="settings-actions">
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="settings-section">
              <h2>Change Password</h2>
              <form onSubmit={handlePasswordChange} autoComplete='off' noValidate>
                <div className="form-group">
                  <label htmlFor="currentPassword">Current Password</label>
                  <div className="password-input-container">
                    <input
                      id="currentPassword"
                      name="currentPassword"
                      required
                      type={showCurrentPassword ? "text" : "password"}
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      disabled={loading}
                    >
                      {showCurrentPassword ? (
                        <FiEye size={20} />
                      ) : (
                        <FiEyeOff size={20} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <div className="password-input-container">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      id="newPassword"
                      name="newPassword"
                      required
                      minLength="8"
                      placeholder="Enter new password (min. 8 characters)"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      disabled={loading}
                    >
                      {showNewPassword ? (
                        <FiEye size={20} />
                      ) : (
                        <FiEyeOff size={20} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm New Password</label>
                  <div className="password-input-container">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      id="confirmPassword"
                      name="confirmPassword"
                      required
                      minLength="8"
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      disabled={loading}
                    >
                      {showConfirmPassword ? (
                        <FiEye size={20} />
                      ) : (
                        <FiEyeOff size={20} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="settings-actions">
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Data & Export Tab */}
          {activeTab === 'data' && (
            <div className="settings-section">
              <h2>Data & Export</h2>
              
              {/* Export Data Section */}
              <div style={{ marginBottom: '40px' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '15px' }}>Export Your Data</h3>
                <p style={{ color: '#6b7280', marginBottom: '20px' }}>
                  Download your questions and study data. Export as PDF for a formatted document, or JSON for raw data backup.
                </p>
                <div className="settings-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => handleDataExport('pdf')} 
                    className="btn-secondary" 
                    disabled={loading}
                  >
                    {loading ? 'Exporting...' : 'Export as PDF'}
                  </button>
                  <button 
                    onClick={() => handleDataExport('json')} 
                    className="btn-outline" 
                    disabled={loading}
                    style={{ background: 'transparent', color: '#666', border: '1px solid #e5e5e5', padding: '0.6rem 1.2rem', borderRadius: '6px', fontSize: '0.9rem' }}
                  >
                    Export as JSON
                  </button>
                </div>
              </div>

              {/* Delete Account Section */}
              <div style={{ paddingTop: '40px', borderTop: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '15px', color: '#dc2626' }}>Danger Zone</h3>
                <p style={{ color: '#6b7280', marginBottom: '20px' }}>
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                <div className="settings-actions">
                  <button 
                    onClick={handleAccountDeletion} 
                    className="btn-danger" 
                    disabled={loading}
                  >
                    {loading ? 'Deleting...' : 'Delete Account'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* OTP Delete Account Modal */}
      {deleteAccountModal && (
        <div className="modal-overlay" onClick={() => setDeleteAccountModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Account</h3>
              <button className="modal-close" onClick={() => setDeleteAccountModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '20px' }}>
                To delete your account, we'll send a verification code to your email address.
              </p>
              
              {!otpSent ? (
                <>
                  <p style={{ color: '#dc2626', marginBottom: '20px' }}>
                    <strong>Warning:</strong> This will permanently delete all your data including questions, results, and uploads. This action cannot be undone.
                  </p>
                  <button 
                    className="btn-primary" 
                    onClick={requestDeleteOtp}
                    disabled={otpLoading}
                    style={{ width: '100%' }}
                  >
                    {otpLoading ? 'Sending...' : 'Send Verification Code'}
                  </button>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label htmlFor="deleteOtp">Enter 6-digit code from your email</label>
                    <input
                      type="text"
                      id="deleteOtp"
                      value={deleteOtp}
                      onChange={(e) => setDeleteOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      maxLength="6"
                      style={{ 
                        textAlign: 'center', 
                        fontSize: '1.5rem', 
                        letterSpacing: '0.5rem',
                        fontFamily: 'monospace'
                      }}
                    />
                  </div>
                  <div className="modal-footer" style={{ gap: '10px', marginTop: '20px' }}>
                    <button 
                      className="btn-secondary" 
                      onClick={() => setDeleteAccountModal(false)}
                      disabled={loading}
                      style={{ flex: 1 }}
                    >
                      Cancel
                    </button>
                    <button 
                      className="btn-danger" 
                      onClick={confirmAccountDeletion}
                      disabled={loading || deleteOtp.length !== 6}
                      style={{ flex: 1 }}
                    >
                      {loading ? 'Deleting...' : 'Delete Account'}
                    </button>
                  </div>
                  <button 
                    onClick={requestDeleteOtp}
                    disabled={otpLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#667eea',
                      cursor: 'pointer',
                      marginTop: '15px',
                      textDecoration: 'underline',
                      width: '100%'
                    }}
                  >
                    {otpLoading ? 'Sending...' : 'Resend Code'}
                  </button>
                </>
              )}
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
        loading={loading}
      />
    </div>
  );
};

export default Settings;
