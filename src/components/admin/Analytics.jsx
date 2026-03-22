import React, { useState, useEffect } from 'react';
import API from '../../services/api';

const Analytics = () => {
  const [analytics, setAnalytics] = useState(null);
  const [apiUsage, setApiUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('30');

  useEffect(() => {
    fetchAllData();
  }, [period]);

  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [analyticsRes, apiUsageRes] = await Promise.allSettled([
        API.get(`/admin/analytics?period=${period}`),
        API.get(`/admin/api-usage?period=${period}`)
      ]);

      // Handle analytics response
      if (analyticsRes.status === 'fulfilled' && analyticsRes.value.data.success) {
        setAnalytics(analyticsRes.value.data.data);
      } else {
        // Set default empty analytics
        setAnalytics({
          engagement: {
            dailyActiveUsers: [],
            topicPopularity: [],
            examCompletionRate: { totalExams: 0, completedExams: 0, avgScore: 0 }
          },
          retention: []
        });
      }

      // Handle API usage response
      if (apiUsageRes.status === 'fulfilled' && apiUsageRes.value.data.success) {
        setApiUsage(apiUsageRes.value.data.data);
      } else {
        // Set default empty API usage
        setApiUsage({
          summary: { totalRequests: 0, totalErrors: 0, avgResponseTime: 0 },
          endpoints: [],
          topUsers: [],
          errors: []
        });
      }

    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError(err.response?.data?.error?.message || err.message || 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading-card">Loading analytics...</div>;
  }

  if (error) {
    return (
      <div className="error-card">
        <p>  {error}</p>
        <button onClick={fetchAllData} className="btn-primary">
            Retry
        </button>
      </div>
    );
  }

  // Safe access helpers
  const safeArray = (arr) => Array.isArray(arr) ? arr : [];
  const safeNumber = (num, fallback = 0) => typeof num === 'number' && !isNaN(num) ? num : fallback;

  return (
    <div className="analytics-container">
      {/* Period Selector */}
      <div className="period-selector">
        <button
          className={`period-btn ${period === '7' ? 'active' : ''}`}
          onClick={() => setPeriod('7')}
        >
          Last 7 Days
        </button>
        <button
          className={`period-btn ${period === '30' ? 'active' : ''}`}
          onClick={() => setPeriod('30')}
        >
          Last 30 Days
        </button>
        <button
          className={`period-btn ${period === '90' ? 'active' : ''}`}
          onClick={() => setPeriod('90')}
        >
          Last 90 Days
        </button>
      </div>

      {/* Engagement Metrics */}
      <div className="analytics-section">
        <h3>User Engagement</h3>
        
        {/* Daily Active Users Chart */}
        {safeArray(analytics?.engagement?.dailyActiveUsers).length > 0 ? (
          <div className="chart-card">
            <h4>Daily Active Users</h4>
            <div className="line-chart">
              {analytics.engagement.dailyActiveUsers.map((day, index) => {
                const maxCount = Math.max(...analytics.engagement.dailyActiveUsers.map(d => d.count || 0), 1);
                return (
                  <div key={index} className="chart-point">
                    <div 
                      className="point-bar"
                      style={{ height: `${((day.count || 0) / maxCount) * 100}%` }}
                      title={`${day.count || 0} users`}
                    />
                    <span className="point-label">
                      {day._id ? new Date(day._id).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="empty-state">No daily active user data available</div>
        )}
                {/* API Usage Analytics */}
      {apiUsage && (
        <div className="analytics-section">
          <h3>API Performance</h3>

          {/* Summary Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <h4>Total Requests</h4>
              <p className="stat-value">
                {safeNumber(apiUsage.summary?.totalRequests).toLocaleString()}
              </p>
            </div>
            <div className="stat-card">
              <h4>Error Rate</h4>
              <p className="stat-value error">
                {apiUsage.summary?.totalRequests > 0 
                  ? ((safeNumber(apiUsage.summary?.totalErrors) / apiUsage.summary.totalRequests) * 100).toFixed(2)
                  : '0.00'}%
              </p>
            </div>
            <div className="stat-card">
              <h4>Avg Response Time</h4>
              <p className="stat-value">
                {safeNumber(apiUsage.summary?.avgResponseTime).toFixed(0)}ms
              </p>
            </div>
          </div>

          {/* Top Endpoints */}
          {safeArray(apiUsage.endpoints).length > 0 && (
            <div className="chart-card">
              <h4>Most Used Endpoints</h4>
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Requests</th>
                      <th>Avg Response</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiUsage.endpoints.map((endpoint, index) => (
                      <tr key={index}>
                        <td><code>{endpoint._id || 'Unknown'}</code></td>
                        <td>{safeNumber(endpoint.totalRequests).toLocaleString()}</td>
                        <td>{safeNumber(endpoint.avgResponseTime).toFixed(0)}ms</td>
                        <td>
                          <span className={endpoint.errorCount > 0 ? 'error-text' : ''}>
                            {safeNumber(endpoint.errorCount)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
                {/* Exam Completion Stats */}
          <div className="stats-grid">
          <div className="stat-card">
            <h4>Total Exams</h4>
            <p className="stat-value">
              {safeNumber(analytics?.engagement?.examCompletionRate?.totalExams)}
            </p>
          </div>
          <div className="stat-card">
            <h4>Completed (50%+)</h4>
            <p className="stat-value">
              {safeNumber(analytics?.engagement?.examCompletionRate?.completedExams)}
            </p>
          </div>
          <div className="stat-card">
            <h4>Average Score</h4>
            <p className="stat-value">
              {safeNumber(analytics?.engagement?.examCompletionRate?.avgScore).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Topic Popularity */}
        {safeArray(analytics?.engagement?.topicPopularity).length > 0 ? (
          <div className="chart-card">
            <h4>Topic Popularity</h4>
            <div className="popularity-list">
              {analytics.engagement.topicPopularity.map((topic, index) => (
                <div key={index} className="popularity-item">
                  <div className="popularity-info">
                    <span className="popularity-rank">#{index + 1}</span>
                    <span className="popularity-name">{topic._id || 'Unknown'}</span>
                  </div>
                  <div className="popularity-stats">
                    <span className="stat-badge">
                       {topic.questionCount || 0} questions
                    </span>
                    <span className="stat-badge">
                       {topic.userCount || 0} users
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">No topic popularity data available</div>
        )}

      </div>



      <button onClick={fetchAllData} className="btn-primary refresh-btn">
          Refresh Analytics
      </button>
    </div>
  );
};

export default Analytics;