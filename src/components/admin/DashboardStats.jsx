import React, { useState, useEffect } from 'react';
import { 
  FiUsers, 
  FiUserCheck, 
  FiUserX, 
  FiShield, 
  FiUserPlus,
  FiMail,
  FiInbox,
  FiClock
} from 'react-icons/fi';
import API from '../../services/api';

const DashboardStats = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await API.get('/admin/dashboard');
      
      if (response.data.success) {
        const backendData = response.data.data;
        
        const transformedStats = {
          users: {
            total: backendData.overview?.totalUsers || 0,
            active: backendData.overview?.activeUsers || 0,
            inactive: backendData.overview?.inactiveUsers || 0,
            admins: backendData.overview?.adminCount || 0,
            newToday: backendData.overview?.recentSignups || 0
          },
          contacts: {
            total: backendData.overview?.totalContacts || 0,
            unread: backendData.overview?.pendingContacts || 0
          },
          recentUsers: backendData.recentUsers || []
        };
        
        setStats(transformedStats);
      } else {
        throw new Error(response.data.error?.message || 'Failed to fetch stats');
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
      const errorMessage = err.response?.data?.error?.message 
        || err.message 
        || 'Failed to load statistics';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="stats-loading">
        <div className="spinner"></div>
        <p>Loading statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-error">
        <p>{error}</p>
        <button onClick={fetchStats} className="btn btn-primary">
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="empty-state">
        <FiUsers className="empty-state-icon" />
        <h3>No Statistics Available</h3>
        <p>Unable to load dashboard statistics.</p>
      </div>
    );
  }

  const statCards = [
    {
      icon: FiUsers,
      label: 'Total Users',
      value: stats.users?.total || 0,
      subtitle: 'Registered accounts'
    },
    {
      icon: FiUserCheck,
      label: 'Active Users',
      value: stats.users?.active || 0,
      change: stats.users?.total > 0 
        ? `${Math.round((stats.users.active / stats.users.total) * 100)}% of total`
        : null,
      changeType: 'positive'
    },
    {
      icon: FiUserX,
      label: 'Inactive Users',
      value: stats.users?.inactive || 0,
      subtitle: 'Deactivated accounts'
    },
    {
      icon: FiShield,
      label: 'Admin Users',
      value: stats.users?.admins || 0,
      subtitle: 'With admin privileges'
    },
    {
      icon: FiUserPlus,
      label: 'New Today',
      value: stats.users?.newToday || 0,
      subtitle: 'Joined today'
    },
    {
      icon: FiMail,
      label: 'Total Contacts',
      value: stats.contacts?.total || 0,
      subtitle: 'Contact submissions'
    },
    {
      icon: FiInbox,
      label: 'Unread Messages',
      value: stats.contacts?.unread || 0,
      changeType: stats.contacts?.unread > 0 ? 'negative' : 'positive',
      change: stats.contacts?.unread > 0 ? 'Needs attention' : 'All read'
    }
  ];

  return (
    <div className="dashboard-stats">
      {/* Stats Grid */}
      <div className="stats-grid">
        {statCards.map((stat, index) => {
          const IconComponent = stat.icon;
          return (
            <div key={index} className="stat-card">
              <div className="stat-icon">
                <IconComponent />
              </div>
              <div className="stat-content">
                <h3>{stat.label}</h3>
                <p className="stat-value">{stat.value.toLocaleString()}</p>
                {stat.change && (
                  <span className={`stat-change ${stat.changeType}`}>
                    {stat.change}
                  </span>
                )}
                {stat.subtitle && !stat.change && (
                  <span className="stat-subtitle">{stat.subtitle}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Users Section */}
      {stats.recentUsers && stats.recentUsers.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h3>Recent Users</h3>
          </div>
          <div className="section-card-body">
            <div className="table-container" style={{ border: 'none', marginBottom: 0 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentUsers.map((user) => (
                    <tr key={user._id}>
                      <td>{user.username}</td>
                      <td>{user.email}</td>
                      <td>
                        <span className={`badge badge-${user.role}`}>
                          {user.role}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${user.isActive ? 'badge-active' : 'badge-inactive'}`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <span className="time-text">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardStats;