import React from 'react';
import { FiAlertTriangle, FiInfo, FiCheckCircle, FiX } from 'react-icons/fi';
import '../../styles/ConfirmDialog.css';

const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'warning', // 'warning', 'danger', 'info', 'success'
  loading = false
}) => {
  if (!isOpen) return null;

  const icons = {
    warning: <FiAlertTriangle className="dialog-icon warning" />,
    danger: <FiAlertTriangle className="dialog-icon danger" />,
    info: <FiInfo className="dialog-icon info" />,
    success: <FiCheckCircle className="dialog-icon success" />
  };

  const handleConfirm = () => {
    if (!loading) {
      onConfirm();
    }
  };

  const handleCancel = () => {
    if (!loading) {
      onClose();
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  };

  return (
    <div className="confirm-dialog-overlay" onClick={handleBackdropClick}>
      <div className={`confirm-dialog ${type}`}>
        <button 
          className="dialog-close-btn" 
          onClick={handleCancel}
          disabled={loading}
          aria-label="Close dialog"
        >
          <FiX />
        </button>

        <div className="dialog-header">
          {icons[type]}
          <h3>{title}</h3>
        </div>

        <div className="dialog-body">
          <p>{message}</p>
        </div>

        <div className="dialog-footer">
          <button
            className="dialog-btn cancel-btn"
            onClick={handleCancel}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            className={`dialog-btn confirm-btn ${type}`}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
