import React, { useState, useEffect } from 'react';
import API from '../../services/api';
import { 
  FiMail, 
  FiTrash
} from 'react-icons/fi';
import { showToast } from '../../utils/toast';
import ConfirmDialog from '../common/ConfirmDialog';

const ContactManagement = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    status: '',
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });
  const [selectedContact, setSelectedContact] = useState(null);
  const [response, setResponse] = useState('');
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    type: 'warning',
    title: '',
    message: '',
    onConfirm: () => {}
  });

  useEffect(() => {
    fetchContacts();
  }, [filters]);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams(filters).toString();
      
      const res = await API.get(`/admin/contacts?${params}`);
      
      setContacts(res.data.data.contacts);
      setPagination(res.data.data.pagination);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
      showToast.error(err.response?.data?.error?.message || 'Failed to fetch contacts');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (contactId, status) => {
    try {
      await API.patch(`/admin/contacts/${contactId}`, { status });
      showToast.success('Contact status updated');
      fetchContacts();
    } catch (err) {
      showToast.error(err.response?.data?.error?.message || 'Failed to update status');
    }
  };

  const handleSendResponse = async () => {
    if (!response.trim()) {
      showToast.warning('Please enter a response message');
      return;
    }

    try {
      const res = await API.post(`/admin/contacts/${selectedContact._id}/respond`, { 
        response: response.trim() 
      });
      
      // Check if there was a warning (email failed but response saved)
      if (res.data.data?.warning) {
        showToast.warning(`${res.data.data.warning}. The response was saved but the email to ${selectedContact.email} failed to send.`);
      } else {
        showToast.success(`Response sent successfully! An email has been sent to ${selectedContact.email}`);
      }
      
      setShowResponseModal(false);
      setResponse('');
      setSelectedContact(null);
      fetchContacts();
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || 'Failed to send response';
      showToast.error(errorMsg);
      console.error('Response error:', err);
    }
  };

  const handleDelete = async (contactId) => {
    setConfirmDialog({
      isOpen: true,
      type: 'danger',
      title: 'Delete Contact',
      message: 'Are you sure you want to delete this contact? This cannot be undone.',
      confirmText: 'Yes, Delete',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          await API.delete(`/admin/contacts/${contactId}`);
          showToast.success('Contact deleted successfully');
          fetchContacts();
        } catch (err) {
          showToast.error(err.response?.data?.error?.message || 'Failed to delete contact');
        }
      }
    });
  };

  return (
    <div className="contact-management">
      {/* Filters */}
      <div className="filters-bar">
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
          className="filter-select"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="in-progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select
          value={filters.sortBy}
          onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
          className="filter-select"
        >
          <option value="createdAt">Sort by Date</option>
          <option value="subject">Sort by Subject</option>
          <option value="status">Sort by Status</option>
        </select>

        <button onClick={fetchContacts} className="btn-primary">
            Refresh
        </button>
      </div>

      {/* Contacts Table */}
      {loading ? (
        <div className="loading-card">Loading contacts...</div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Contact Info</th>
                  <th>Ticket ID</th>
                  <th>Subject</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(contact => (
                  <tr key={contact._id}>
                    <td>
                      <div className="contact-info">
                        <strong>{contact.name}</strong>
                        {/* <span className="contact-email">{contact.email}</span> */}
                      </div>
                    </td>
                    <td>
                      <span className="ticket-id-badge">
                        {contact.ticketId || 'N/A'}
                      </span>
                    </td>
                    <td>
                      <strong>{contact.subject}</strong>
                    </td>
                    <td>
                      <div className="message-preview">
                        {contact.message.substring(0, 100)}
                        {contact.message.length > 100 && '...'}
                      </div>
                    </td>
                    <td>
                      <select
                        value={contact.status}
                        onChange={(e) => handleStatusChange(contact._id, e.target.value)}
                        className={`status-select status-${contact.status}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="in-progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                    </td>
                    <td>
                      {new Date(contact.createdAt).toLocaleDateString()}
                      <br />
                      <span className="time-text">
                        {new Date(contact.createdAt).toLocaleTimeString()}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn-icon btn-response"
                          onClick={() => {
                            setSelectedContact(contact);
                            setShowResponseModal(true);
                          }}
                          title="Send Response"
                        >
                          <FiMail />
                        </button>
                        <button
                          className="btn-icon btn-danger"
                          onClick={() => handleDelete(contact._id)}
                          title="Delete"
                        >
                          <FiTrash />
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
              ← Previous
            </button>
            
            <span className="pagination-info">
              Page {pagination.currentPage} of {pagination.totalPages}
            </span>
            
            <button
              className="btn-secondary"
              disabled={pagination.currentPage === pagination.totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              Next →
            </button>
          </div>
        </>
      )}

      {/* Response Modal */}
      {showResponseModal && selectedContact && (
        <div className="modal-overlay" onClick={() => setShowResponseModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Respond to {selectedContact.name}</h2>
              <button 
                className="modal-close"
                onClick={() => setShowResponseModal(false)}
              >
                ✕
              </button>
            </div>
            
            <div className="modal-body">
              <div className="original-message">
                <h4>Original Message:</h4>
                <p><strong>Subject:</strong> {selectedContact.subject}</p>
                <p><strong>From:</strong> {selectedContact.email}</p>
                <div className="message-content">
                  {selectedContact.message}
                </div>
              </div>

              <div className="response-form">
                <label>Your Response:</label>
                <textarea
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Type your response here..."
                  rows="8"
                  className="response-textarea"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button 
                className="btn-secondary"
                onClick={() => setShowResponseModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn-primary"
                onClick={handleSendResponse}
              >
                <FiMail/> Send Response
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

export default ContactManagement;