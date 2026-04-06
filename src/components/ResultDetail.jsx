import React, { useEffect, useState } from "react";
import {useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import API from "../services/api.js";
import "../styles/resultDetail.css";
import { showToast } from "../utils/toast.js";
import { handleApiError } from '../utils/errorHandler.js';
import { FiArrowLeft, FiCheck, FiX, FiMinus } from 'react-icons/fi';

const ResultDetail = () => {
  const { resultId } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuth();

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('mcq');

  useEffect(() => {
    // Only fetch if auth is initialized and user is authenticated
    if (isInitialized && isAuthenticated && user) {
      fetchResultDetail();
    } else if (isInitialized && !isAuthenticated) {
      // Auth completed but user not authenticated - redirect to login
      navigate('/login');
    }
  }, [resultId, isInitialized, isAuthenticated, user]);

  const fetchResultDetail = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await API.get(`/results/${resultId}`);

      if (response.data.success) {
        setResult(response.data.data);
      } else {
        setError(response.data.error?.message || 'Failed to fetch result details');
        showToast.error('Failed to load result details');
      }
    } catch (err) {
      console.error('Error fetching result detail:', err);
      const errorMsg = handleApiError(err);

      // Check if it's an authentication error
      if (err.response?.status === 401) {
        showToast.error('Session expired. Please login again.');
        // Clear any stale auth data
        sessionStorage.removeItem('authToken');
        sessionStorage.removeItem('refreshToken');
        sessionStorage.removeItem('user');
        navigate('/login');
      } else if (err.response?.status === 403) {
        showToast.error('You do not have permission to view this result');
        navigate('/student');
      } else {
        setError(errorMsg);
        showToast.error(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const getTabForType = (type) => {
    const normalized = (type || '').toLowerCase();
    if (normalized === 'fill-in-blank') return 'gap';
    if (normalized === 'short-answer' || normalized === 'essay') return 'theory';
    return 'mcq';
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };



  if (loading) {
    return (
      <div className="result-detail-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading result details...</p>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="result-detail-container">
        <div className="error-message">
          <FiX className="error-icon" />
          <h2>Error Loading Result</h2>
          <p>{error || 'Result not found'}</p>
          <button onClick={() => navigate(-1)} className="back-button">
            <FiArrowLeft /> Back
          </button>
        </div>
      </div>
    );
  }

  const groupedCounts = result?.answers?.reduce((acc, answer) => {
    const tab = getTabForType(answer.questionType);
    acc[tab] = (acc[tab] || 0) + 1;
    return acc;
  }, { mcq: 0, gap: 0, theory: 0 });

  const tabs = [
    { id: 'mcq', label: 'MCQ', count: groupedCounts?.mcq || 0 },
    { id: 'gap', label: 'Fill-in Gap', count: groupedCounts?.gap || 0 },
    { id: 'theory', label: 'Theory', count: groupedCounts?.theory || 0 }
  ];

  const filteredAnswers = (result?.answers || [])
    .filter((answer) => getTabForType(answer.questionType) === activeTab)
    .sort((a, b) => (a.questionNumber || 0) - (b.questionNumber || 0));

  return (
    <div className="result-detail-container">
      <div className="result-titlebar">
        <button onClick={() => navigate(-1)} className="back-icon">
          <FiArrowLeft />
        </button>
        <div>
          <h1> {result.topic} Results — {result.percentage}%</h1>
          <p className="result-meta">
            {result.topic} · {formatDate(result.createdAt)} · {formatTime(result.timeSpentSeconds)}
          </p>
        </div>
      </div>

      <div className="result-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`result-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <div className="result-question-list">
        {filteredAnswers.length === 0 ? (
          <div className="no-questions">
            <p>No questions available for this section.</p>
          </div>
        ) : (
          filteredAnswers.map((answer, index) => {
            const status = answer.isCorrect ? 'correct' : answer.isSkipped ? 'skipped' : 'incorrect';
            return (
              <div key={index} className={`result-question-card ${status}`}>
                <div className="result-question-header">
                  <div className={`result-status-icon ${status}`}>
                    {answer.isCorrect ? <FiCheck /> : answer.isSkipped ? <FiMinus /> : <FiX />}
                  </div>
                  <div className="result-question-title">
                    <span className="result-question-number">Question {answer.questionNumber}</span>
                    <h3>{answer.questionText}</h3>
                  </div>
                </div>

                <div className="result-options">
                  {(() => {
                    const qType = (answer.questionType || '').toLowerCase();
                    const isFill = qType === 'fill-in-blank' || qType === 'fill-in-gap';
                    const isTheory = qType === 'theory' || qType === 'short-answer' || qType === 'essay';

                    if (isFill) {
                      return (
                        <div className="result-text-answer">
                          <div className={`result-text-response ${answer.isCorrect ? 'correct' : answer.isSkipped ? 'skipped' : 'incorrect'}`}>
                            <span className="result-text-label">Your Answer:</span>
                            <span className="result-text-value">{answer.userSelectedText || '(skipped)'}</span>
                          </div>
                          {answer.blankAnswer && (
                            <div className="result-text-response correct">
                              <span className="result-text-label">Correct Answer:</span>
                              <span className="result-text-value">{answer.blankAnswer}</span>
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (isTheory) {
                      return (
                        <div className="result-text-answer">
                          <div className={`result-text-response ${answer.isSkipped ? 'skipped' : 'neutral'}`}>
                            <span className="result-text-label">Your Answer:</span>
                            <span className="result-text-value">{answer.userSelectedText || '(skipped)'}</span>
                          </div>
                          {answer.modelAnswer && (
                            <div className="result-text-response correct">
                              <span className="result-text-label">Model Answer:</span>
                              <span className="result-text-value">{answer.modelAnswer}</span>
                            </div>
                          )}
                        </div>
                      );
                    }

                    // MCQ rendering
                    return answer.options.map((option, optionIndex) => {
                      const isUserAnswer = answer.userSelectedIndex === optionIndex;
                      const isCorrectAnswer = answer.correctAnswerIndex === optionIndex;
                      return (
                        <div
                          key={optionIndex}
                          className={`result-option ${isCorrectAnswer ? 'correct' : ''} ${isUserAnswer && !isCorrectAnswer ? 'incorrect' : ''}`}
                        >
                          <span className="result-option-letter">
                            {String.fromCharCode(65 + optionIndex)}
                          </span>
                          <span className="result-option-text">{option}</span>
                        </div>
                      );
                    });
                  })()}
                </div>

                {answer.explanation && (
                  <div className="result-explanation">
                    {answer.explanation}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ResultDetail;
