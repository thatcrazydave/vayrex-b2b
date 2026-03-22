import React, { useState, useEffect } from 'react';
import API from '../../services/api';
import { FaTrash } from 'react-icons/fa';
import { FiEye } from 'react-icons/fi';
import { showToast } from '../../utils/toast';
import ConfirmDialog from '../common/ConfirmDialog';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    search: '',
    role: '',
    status: '',
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    type: 'warning',
    title: '',
    message: '',
    onConfirm: () => {}
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      if(searchTerm !== filters.search) {
        setFilters(prev => ({ ...prev, search: searchTerm, page: 1 }));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm, filters.search]);

  useEffect(() => {
    fetchUsers();
  }, [filters]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      const filteredParams = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== '')
      );
      const params = new URLSearchParams(filteredParams).toString();

      const response = await API.get(`/admin/users?${params}`);

      if (response.data.success) {
        setUsers(response.data.data?.users || []);
        setPagination(response.data.data?.pagination || {});
      } else {
        setError(response.data.error?.message || 'Failed to fetch users');
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err.response?.data?.error?.message || err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    setConfirmDialog({
      isOpen: true,
      type: 'warning',
      title: 'Change User Role',
      message: `Are you sure you want to change this user's role to ${newRole}?`,
      confirmText: 'Yes, Change Role',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          await API.patch(`/admin/users/${userId}/role`, { role: newRole });
          showToast.success('User role updated successfully');
          fetchUsers();
        } catch (err) {
          showToast.error(err.response?.data?.error?.message || 'Failed to update user role');
        }
      }
    });
  };

  const handleDeleteUser = async (userId) => {
    setConfirmDialog({
      isOpen: true,
      type: 'danger',
      title: 'Delete User',
      message: 'Are you sure you want to delete this user? This action cannot be undone.',
      confirmText: 'Yes, Delete',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          await API.delete(`/admin/users/${userId}`);
          showToast.success('User deleted successfully');
          fetchUsers();
        } catch (err) {
          showToast.error(err.response?.data?.error?.message || 'Failed to delete user');
        }
      }
    });
  };

  const viewUserDetails = async (userId) => {
    try {
      const response = await API.get(`/admin/users/${userId}`);
      
      if (response.data.success) {
        setSelectedUser(response.data.data);
        setShowUserModal(true);
      }
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to fetch user details');
    }
  };

  if (error) {
    return (
      <div className="error-card">
        <p>{error}</p>
        <button onClick={fetchUsers} className="btn-primary">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="user-management">
      {/* Filters */}
      <div className="filters-bar">
        <input
          type="text"
          placeholder="Search users..."
          className="search-input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <select
          value={filters.role}
          onChange={(e) => setFilters({ ...filters, role: e.target.value, page: 1 })}
          className="filter-select"
        >
          <option value="">All Roles</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="superadmin">Super Admin</option>
        </select>

        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
          className="filter-select"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <button onClick={fetchUsers} className="btn-primary">
          Refresh
        </button>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="loading-card">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p>No users found</p>
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Stats</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user._id}>
                    <td>
                      <div className="user-info">
                        <strong>{user.username}</strong>
                      </div>
                    </td>
                    <td>
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user._id, e.target.value)}
                        className={`role-select role-${user.role}`}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                        <option value="superadmin">Super Admin</option>
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${user.isActive ? 'badge-active' : 'badge-inactive'}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="user-stats">
                        <span>{user.stats?.uploads || 0}</span>
                        <span>{user.stats?.exams || 0}</span>
                      </div>
                    </td>
                    <td>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn-icon btn-info"
                          onClick={() => viewUserDetails(user._id)}
                          title="View Details"
                        >
                          <FiEye size={20} />
                        </button>
                        <button
                          className="btn-icon btn-danger"
                          onClick={() => handleDeleteUser(user._id)}
                          title="Delete User"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination">
            <button
              className="btn-secondary"
              disabled={pagination.currentPage === 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
            >
              Previous
            </button>
            
            <span className="pagination-info">
              Page {pagination.currentPage || 1} of {pagination.totalPages || 1}
              ({pagination.totalUsers || 0} total users)
            </span>
            
            <button
              className="btn-secondary"
              disabled={pagination.currentPage === pagination.totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* User Details Modal */}
      {showUserModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
          <div className="modal-content large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>User Details: {selectedUser.user?.username}</h2>
              <button 
                className="modal-close"
                onClick={() => setShowUserModal(false)}
              >
                X
              </button>
            </div>
            
            <div className="modal-body">
              <div className="user-detail-grid">
                <div className="detail-item">
                  <label>Email</label>
                  <span>{selectedUser.user?.email}</span>
                </div>
                <div className="detail-item">
                  <label>Role</label>
                  <span className={`role-badge role-${selectedUser.user?.role}`}>
                    {selectedUser.user?.role}
                  </span>
                </div>
                <div className="detail-item">
                  <label>Status</label>
                  <span className={selectedUser.user?.isActive ? 'status-active' : 'status-inactive'}>
                    {selectedUser.user?.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="detail-item">
                  <label>Joined</label>
                  <span>{new Date(selectedUser.user?.createdAt).toLocaleString()}</span>
                </div>
              </div>

              {selectedUser.user?.stats && (
                <div className="stats-section">
                  <h4>Statistics</h4>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span className="stat-label">Uploads</span>
                      <span className="stat-value">{selectedUser.user.stats.totalUploads || 0}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Questions</span>
                      <span className="stat-value">{selectedUser.user.stats.totalQuestions || 0}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Exams</span>
                      <span className="stat-value">{selectedUser.user.stats.totalExams || 0}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Avg Score</span>
                      <span className="stat-value">{selectedUser.user.stats.avgScore || 0}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary"
                onClick={() => setShowUserModal(false)}
              >
                Close
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
      />
    </div>
  );
};

export default UserManagement;