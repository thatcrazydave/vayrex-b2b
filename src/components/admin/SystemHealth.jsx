import React, { useState, useEffect } from 'react';
import API from '../../services/api'; //   FIX: Use API service
import { showToast } from '../../utils/toast';

const SystemHealth = () => {
  const [health, setHealth] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [alertFilters, setAlertFilters] = useState({
    severity: '',
    status: 'active'
  });

  useEffect(() => {
    fetchHealthData();
    const interval = setInterval(fetchHealthData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [alertFilters]);

  const fetchHealthData = async () => {
    try {
      setError(null);
      
      //   FIX: Use API service (handles auth automatically)
      const response = await API.get('/admin/system/health');
      
      if (response.data.success) {
        setHealth(response.data.data);
      } else {
        setError(response.data.error?.message || 'Failed to fetch health data');
      }
    } catch (err) {
      console.error('Failed to fetch health data:', err);
      setError(err.response?.data?.error?.message || err.message || 'Failed to fetch health data');
    }
  };

  const fetchAlerts = async () => {
    try {
      setLoading(true);

      // Filter out empty string values before creating params
      const filteredParams = Object.fromEntries(
        Object.entries(alertFilters).filter(([_, v]) => v !== '')
      );
      const params = new URLSearchParams(filteredParams).toString();
      
      //   FIX: Use API service
      const response = await API.get(`/admin/system/alerts${params ? `?${params}` : ''}`);
      
      if (response.data.success) {
        setAlerts(response.data.data?.alerts || []);
      } else {
        setAlerts([]);
      }
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveAlert = async (alertId) => {
    const resolution = prompt('Enter resolution notes:');
    if (!resolution) return;

    try {
      //   FIX: Use API service
      await API.patch(`/admin/system/alerts/${alertId}`, { 
        status: 'resolved', 
        resolution 
      });
      
      showToast.success('Alert resolved successfully');
      fetchAlerts();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to resolve alert');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return '#10b981';
      case 'degraded': return '#f59e0b';
      case 'down': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return '#dc2626';
      case 'high': return '#ea580c';
      case 'medium': return '#f59e0b';
      case 'low': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  // Error state
  if (error) {
    return (
      <div className="error-card">
        <div className="error-content">
          <span className="error-icon"> </span>
          <p>{error}</p>
          <button onClick={fetchHealthData} className="btn-primary">
              Retry
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (!health) {
    return <div className="loading-card">Loading system health...</div>;
  }

  // Safe access helpers
  const services = health.services || {};
  const memory = health.memory || { heapUsed: 0, heapTotal: 0, percentUsed: 0 };
  const cpu = health.cpu || { user: 0 };
  const uptime = health.uptime || 0;

  return (
    <div className="system-health">
      {/* Overall Health Status */}
      <div className="health-overview">
        <div className="health-status-card">
          <div 
            className="status-indicator"
            style={{ backgroundColor: getStatusColor(health.status) }}
          />
          <div className="status-content">
            <h2>System Status: {(health.status || 'unknown').toUpperCase()}</h2>
            <p className="status-timestamp">
              Last checked: {health.timestamp ? new Date(health.timestamp).toLocaleString() : 'N/A'}
            </p>
          </div>
          <button onClick={fetchHealthData} className="btn-primary">
              Refresh
          </button>
        </div>
      </div>

      {/* Service Health Grid */}
      <div className="services-grid">
        <div className="service-card">
          <div className="service-header">
            <h3>MongoDB</h3>
            <span className={`service-status ${services.mongodb ? 'healthy' : 'down'}`}>
              {services.mongodb ? '  Healthy' : '  Down'}
            </span>
          </div>
        </div>

        <div className="service-card">
          <div className="service-header">
            <h3>Redis</h3>
            <span className={`service-status ${services.redis ? 'healthy' : 'down'}`}>
              {services.redis ? '  Healthy' : '  Down'}
            </span>
          </div>
        </div>

        <div className="service-card">
          <div className="service-header">
            <h3>AWS S3</h3>
            <span className={`service-status ${services.s3 ? 'healthy' : 'down'}`}>
              {services.s3 ? '  Healthy' : '  Down'}
            </span>
          </div>
        </div>

        <div className="service-card">
          <div className="service-header">
            <h3>Memory</h3>
            <span className={`service-status ${services.memory ? 'healthy' : 'warning'}`}>
              {services.memory ? '  Normal' : '  High'}
            </span>
          </div>
          <div className="memory-usage">
            <div className="usage-bar">
              <div 
                className="usage-fill"
                style={{ width: `${memory.percentUsed || 0}%` }}
              />
            </div>
            <span className="usage-text">{memory.percentUsed || 0}% used</span>
          </div>
        </div>
      </div>

      {/* System Metrics */}
      <div className="metrics-section">
        <h3>System Metrics</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-label">Uptime</span>
            <span className="metric-value">
              {Math.floor(uptime / 3600)}h {Math.floor((uptime % 3600) / 60)}m
            </span>
          </div>
          
          <div className="metric-card">
            <span className="metric-label">Memory Used</span>
            <span className="metric-value">
              {(memory.heapUsed / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
          
          <div className="metric-card">
            <span className="metric-label">Memory Total</span>
            <span className="metric-value">
              {(memory.heapTotal / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
          
          <div className="metric-card">
            <span className="metric-label">CPU User</span>
            <span className="metric-value">
              {(cpu.user / 1000).toFixed(2)}ms
            </span>
          </div>
        </div>
      </div>

      {/* Alerts Section */}
      <div className="alerts-section">
        <div className="section-header">
          <h3>System Alerts</h3>
          <div className="alert-filters">
            <select
              value={alertFilters.severity}
              onChange={(e) => setAlertFilters({ ...alertFilters, severity: e.target.value })}
              className="filter-select"
            >
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <select
              value={alertFilters.status}
              onChange={(e) => setAlertFilters({ ...alertFilters, status: e.target.value })}
              className="filter-select"
            >
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
              <option value="">All</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-card">Loading alerts...</div>
        ) : alerts.length === 0 ? (
          <div className="empty-state">
            <p>  No alerts found</p>
          </div>
        ) : (
          <div className="alerts-list">
            {alerts.map(alert => (
              <div key={alert._id} className="alert-card">
                <div 
                  className="alert-severity"
                  style={{ backgroundColor: getSeverityColor(alert.severity) }}
                />
                <div className="alert-content">
                  <div className="alert-header">
                    <h4>{alert.message}</h4>
                    <span className={`alert-status ${alert.status}`}>
                      {alert.status}
                    </span>
                  </div>
                  <div className="alert-details">
                    <span className="alert-service">Service: {alert.service || 'Unknown'}</span>
                    <span className="alert-type">Type: {alert.type || 'Unknown'}</span>
                    <span className="alert-time">
                      {alert.createdAt ? new Date(alert.createdAt).toLocaleString() : 'N/A'}
                    </span>
                  </div>
                  {alert.details && (
                    <pre className="alert-details-json">
                      {JSON.stringify(alert.details, null, 2)}
                    </pre>
                  )}
                  {alert.resolution && (
                    <div className="alert-resolution">
                      <strong>Resolution:</strong> {alert.resolution}
                    </div>
                  )}
                </div>
                {alert.status === 'active' && (
                  <button
                    className="btn-primary"
                    onClick={() => handleResolveAlert(alert._id)}
                  >
                      Resolve
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemHealth;