import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import API, { exportPDF } from "../services/api.js";
import "../styles/admin.css";
import { showToast } from "../utils/toast.js";
import { FiMail, FiX, FiDownload, FiFileText, FiAward, FiBook, FiTrendingUp, FiClock, FiTrash2 } from 'react-icons/fi';
import { handleApiError } from '../utils/errorHandler.js';
import ExportSettingsModal from './common/ExportSettingsModal.jsx';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dashboardData, setDashboardData] = useState({
    uploads: [],
    results: [],
    questions: [],
    stats: {
      totalUploads: 0,
      totalQuestions: 0,
      totalResults: 0,
      averageScore: 0,
      bestScore: 0,
      topicsCount: 0
    }
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    uploadId: null,
    topic: null,
    isDeleting: false
  });
  const [showEmailBanner, setShowEmailBanner] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(null);
  const [exportModal, setExportModal] = useState({ isOpen: false, topic: null });

  // Check if user dismissed banner in this session
  useEffect(() => {
    const checkVerificationStatus = () => {
      if (!user) return;

      // Check actual verification status from user object
      const isVerified = user.emailVerified === true;
      setEmailVerified(isVerified);

      // Only show banner if NOT verified
      if (!isVerified) {
        // Check if user dismissed it in current session
        const dismissed = sessionStorage.getItem(`emailBannerDismissed_${user.id}`);
        setShowEmailBanner(!dismissed);
      } else {
        setShowEmailBanner(false);
      }
    };

    checkVerificationStatus();
  }, [user]);

  const handleDismissBanner = () => {
    setShowEmailBanner(false);
    // Store dismissal in session storage - will show again on next login
    if (user?.id) {
      sessionStorage.setItem(`emailBannerDismissed_${user.id}`, 'true');
    }
  };

  const handleResendVerification = async () => {
    try {
      const response = await API.post('/auth/resend-verification');
      if (response.data.success) {
        showToast.success(response.data.message);
      }
    } catch (error) {
      showToast.error(error.response?.data?.error?.message || 'Failed to resend verification email');
    }
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const [uploadsRes, resultsRes] = await Promise.all([
          API.get("/user/uploads"),
          API.get("/results")
        ]);

        const uploads = uploadsRes.data?.data || [];
        const results = resultsRes.data?.data || [];

        // Calculate statistics
        const totalScores = results.map(r => r.percentage);
        const averageScore = totalScores.length > 0
          ? Math.round(totalScores.reduce((a, b) => a + b, 0) / totalScores.length)
          : 0;
        const bestScore = totalScores.length > 0 ? Math.max(...totalScores) : 0;
        const topicsCount = new Set(results.map(r => r.topic)).size;

        setDashboardData({
          uploads,
          results,
          questions: [],
          stats: {
            totalUploads: uploads.length,
            totalQuestions: uploads.reduce((sum, upload) => sum + (upload.numberOfQuestions || 0), 0),
            totalResults: results.length,
            averageScore,
            bestScore,
            topicsCount
          }
        });
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        // Use standardized error handler - this will stop loading
        handleApiError(err, setLoading, setError);
      } finally {
        // Ensure loading is always stopped
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getScoreColor = (percentage) => {
    if (percentage >= 80) return '#10b981'; // green
    if (percentage >= 60) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };

  const openDeleteModal = (uploadId, topic) => {
    setDeleteModal({
      isOpen: true,
      uploadId,
      topic,
      isDeleting: false
    });
  };

  const closeDeleteModal = () => {
    setDeleteModal({
      isOpen: false,
      uploadId: null,
      topic: null,
      isDeleting: false
    });
  };

  const handleDeleteConfirm = async () => {
    try {
      setDeleteModal(prev => ({ ...prev, isDeleting: true }));

      // Delete by _id so cards with the same topic name are independently removable
      const response = await API.delete(`/uploads/id/${deleteModal.uploadId}`);

      if (response.data.success) {
        // Remove from local state
        setDashboardData(prev => ({
          ...prev,
          uploads: prev.uploads.filter(u => u._id !== deleteModal.uploadId),
          stats: {
            ...prev.stats,
            totalUploads: prev.stats.totalUploads - 1,
            totalQuestions: prev.stats.totalQuestions - (
              prev.uploads.find(u => u._id === deleteModal.uploadId)?.numberOfQuestions || 0
            )
          }
        }));

        closeDeleteModal();
        showToast.success('Upload deleted successfully');
      }
    } catch (err) {
      console.error("Error deleting upload:", err);
      showToast.error(err.response?.data?.error?.message || err.response?.data?.message || "Failed to delete upload");
    } finally {
      setDeleteModal(prev => ({ ...prev, isDeleting: false }));
    }
  };

  const handleDownloadPDF = async (topic) => {
    setExportModal({ isOpen: true, topic });
  };

  const handleExportConfirm = async (settings) => {
    const topic = exportModal.topic;
    try {
      setDownloadingPdf(topic);
      await exportPDF(topic, {
        includeAnswers: settings.includeAnswers,
        format: settings.format,
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        filename: `${topic.replace(/[^a-zA-Z0-9]/g, '_')}_questions.pdf`
      });
      showToast.success('PDF downloaded!');
      setExportModal({ isOpen: false, topic: null });
    } catch (err) {
      const msg = err.response?.status === 403
        ? 'PDF export requires Pro plan or above.'
        : 'Failed to download PDF.';
      showToast.error(msg);
    } finally {
      setDownloadingPdf(null);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Loading your dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  const handleLogout = () => {
    logout();
    setIsOpen(false);
    navigate('/');
  };

  return (
    <>
    <div className="dashboard">
      {/* Email Verification Banner */}
      {!emailVerified && showEmailBanner && (
        <div className="email-verification-banner">
          <div className="banner-content">
            <span className="banner-icon">
              <FiMail size={24} />
            </span>
            <div className="banner-text">
              <strong>Verify your email address</strong>
              <p>Please check your inbox and click the verification link to access all features.</p>
            </div>
            <div className="banner-actions">
              <button
                className="btn-resend"
                onClick={handleResendVerification}
              >
                Resend Email
              </button>
              <button
                className="btn-dismiss"
                onClick={handleDismissBanner}
              >
                <FiX size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div className="modal-overlay" onClick={closeDeleteModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Upload</h3>
              <button className="modal-close" onClick={closeDeleteModal}>×</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete <strong>"{deleteModal.topic}"</strong>?</p>
              <p className="warning-text">This action will:</p>
              <ul className="warning-list">
                <li>Delete all questions from this upload</li>
                <li>Delete backup files</li>
                <li>This action cannot be undone</li>
              </ul>
            </div>
            <div className="modal-footer">
              <button
                className="action-btn secondary"
                onClick={closeDeleteModal}
                disabled={deleteModal.isDeleting}
              >
                Cancel
              </button>
              <button
                className="action-btn danger"
                onClick={handleDeleteConfirm}
                disabled={deleteModal.isDeleting}
              >
                {deleteModal.isDeleting ? 'Deleting...' : 'Delete Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Section */}
      <div className="dashboard-header">
        <div className="welcome-section">
          <h1>Welcome back, {user?.username}!</h1>
          <p>Here's your learning overview and progress</p>
        </div>
        <div className="quick-actions">
          {/* <button className="action-btn secondary" onClick={() => window.location.href = '/learn'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
            Start Learning
          </button>
          <button className="action-btn tertiary" onClick={() => window.location.href = '/AI'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"/>
            </svg>
            AI Assistant
          </button> */}
        </div>
      </div>

      {/* Stats Overview */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">
            <FiFileText size={24} />
          </div>
          <div className="stat-content">
            <h3>{dashboardData.stats.totalUploads}</h3>
            <p>Files Uploaded</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <FiAward size={24} />
          </div>
          <div className="stat-content">
            <h3>{dashboardData.stats.bestScore}%</h3>
            <p>Best Score</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <FiBook size={24} />
          </div>
          <div className="stat-content">
            <h3>{dashboardData.stats.topicsCount}</h3>
            <p>Topics Studied</p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="dashboard-tabs">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <span className="tab-icon">
            <FiTrendingUp size={16} />
          </span>
          Overview
        </button>
        <button
          className={`tab-btn ${activeTab === 'results' ? 'active' : ''}`}
          onClick={() => setActiveTab('results')}
        >
          <span className="tab-icon">
            <FiTrendingUp size={16} />
          </span>
          Results
        </button>
        <button
          className={`tab-btn ${activeTab === 'uploads' ? 'active' : ''}`}
          onClick={() => setActiveTab('uploads')}
        >
          <span className="tab-icon">
            <FiFileText size={16} />
          </span>
          Uploads
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'overview' && (
          <div className="overview-section">
            <div className="recent-results">
              <h3>Recent Quiz Results</h3>
              {dashboardData.results.slice(0, 5).length === 0 ? (
                <p className="no-data">No quiz results yet. <a href="/learn">Take your first quiz!</a></p>
              ) : (
                <div className="results-list">
                  {dashboardData.results.slice(0, 5).map((result) => (
                    <div key={result._id} className="result-item">
                      <div className="result-header">
                        <h4>{result.topic}</h4>
                        <div className="result-header-right">
                          {result.mode === 'practice' && <span className="mode-badge practice">Practice</span>}
                          <span className="result-date">{formatDate(result.createdAt)}</span>
                        </div>
                      </div>
                      <div className="result-details">
                        <div className="score-display">
                          <span
                            className="score-percentage"
                            style={{ color: getScoreColor(result.percentage) }}
                          >
                            {Math.round(result.percentage)}%
                          </span>
                          <span className="score-details">
                            {result.correctCount}/{result.totalQuestions} correct
                          </span>
                        </div>
                        <div className="result-meta">
                          <span>
                            <FiClock size={12} />
                            {formatTime(result.timeSpentSeconds)}
                          </span>
                          {result.difficulty && <span>
                            <FiTrendingUp size={12} />
                            {result.difficulty}
                          </span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="recent-uploads">
              <h3>Recent Uploads</h3>
              {dashboardData.uploads.slice(0, 3).length === 0 ? (
                <p className="no-data">No files uploaded yet. <a href="/Upload">Upload your first file!</a></p>
              ) : (
                <div className="uploads-list">
                  {dashboardData.uploads.slice(0, 3).map((upload) => (
                    <div key={upload._id} className="upload-item">
                      <div className="upload-header">
                        <h4>{upload.topic}</h4>
                        <span className="upload-date">{formatDate(upload.uploadedAt)}</span>
                      </div>
                      <div className="upload-details">
                        <p><strong>File:</strong> {upload.fileName}</p>
                        <p><strong>Questions:</strong> {upload.numberOfQuestions}</p>
                        <p><strong>Has Answers:</strong> {upload.hasAnswers ? 'Yes' : 'No'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="results-section">
            <h3>All Quiz Results</h3>
            {dashboardData.results.length === 0 ? (
              <div className="no-data">
                <p>No quiz results yet. <a href="/learn">Take your first quiz!</a></p>
              </div>
            ) : (
              <div className="results-grid">
                {dashboardData.results.map((result) => (
                  <div
                    key={result._id}
                    className="result-card clickable"
                    onClick={() => navigate(`/results/${result._id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="result-header">
                      <h4>{result.topic}</h4>
                      <span className="result-date">{formatDate(result.createdAt)}</span>
                    </div>
                    <div className="result-score">
                      <div
                        className="score-circle"
                        style={{
                          background: `conic-gradient(${getScoreColor(result.percentage)} ${Math.round(result.percentage) * 3.6}deg, #e5e7eb 0deg)`
                        }}
                      >
                        <span className="score-text">{Math.round(result.percentage)}%</span>
                      </div>
                    </div>
                    <div className="result-details">
                      <p><strong>Correct:</strong> {result.correctCount}/{result.totalQuestions}</p>
                      <p><strong>Time:</strong> {formatTime(result.timeSpentSeconds)}</p>
                      {result.difficulty && <p><strong>Difficulty:</strong> {result.difficulty}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'uploads' && (
          <div className="uploads-section">
            <h3>All Uploaded Files</h3>
            {dashboardData.uploads.length === 0 ? (
              <div className="no-data">
                <p>No files uploaded yet. <a href="/Upload">Upload your first file!</a></p>
              </div>
            ) : (
              <div className="uploads-grid">
                {dashboardData.uploads.map((upload) => (
                  <div key={upload._id} className="upload-card">
                    <div className="upload-header">
                      <h4>{upload.topic}</h4>
                      <span className="upload-date">{formatDate(upload.uploadedAt)}</span>
                    </div>
                    <div className="upload-details">
                      <p><strong>File:</strong> {upload.fileName}</p>
                      <p><strong>Questions:</strong> {upload.numberOfQuestions}</p>
                      <p><strong>Has Answers:</strong> {upload.hasAnswers ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="upload-actions">
                      {user?.limits?.pdfExport && (
                        <button
                          className="action-btn secondary small"
                          onClick={() => handleDownloadPDF(upload.topic)}
                          disabled={downloadingPdf === upload.topic}
                          title="Download questions as PDF"
                          style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <FiDownload size={14} />
                          {downloadingPdf === upload.topic ? 'Downloading...' : 'PDF'}
                        </button>
                      )}
                      <button
                        className="action-btn danger small"
                        onClick={() => openDeleteModal(upload._id, upload.topic)}
                      >
                        <FiTrash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    <ExportSettingsModal
      isOpen={exportModal.isOpen}
      onClose={() => setExportModal({ isOpen: false, topic: null })}
      onExport={handleExportConfirm}
      topic={exportModal.topic}
      loading={!!downloadingPdf}
    />
    </>
  );
};

export default Dashboard;
