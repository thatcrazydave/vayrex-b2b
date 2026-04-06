import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiBarChart2,
  FiUsers,
  FiMail,
  FiTrendingUp,
  FiActivity,
  FiDatabase,
  FiFileText,
  FiLogOut,
  FiMenu,
  FiX,
  FiShield,
  FiDollarSign
} from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import '../styles/adminDashboard.css';
import DashboardStats from './admin/DashboardStats';
import UserManagement from './admin/UserManagement';
import ContactManagement from './admin/ContactManagement';
import SystemHealth from './admin/SystemHealth';
import Analytics from './admin/Analytics';
import BackupManager from './admin/BackupManager';
import AuditLogs from './admin/AuditLogs';
import PricingManager from './admin/PricingManager';

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  // Use AuthContext instead of localStorage
  const { user, logout, isAdmin, loading } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/Login');
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner"></div>
        <p>Loading Admin Dashboard...</p>
      </div>
    );
  }

  if (!user || !isAdmin) {
    navigate('/');
    return null;
  }

  const isSuperAdmin = user?.role === 'superadmin';

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: FiBarChart2 },
    { id: 'users', label: 'Users', icon: FiUsers },
    { id: 'contacts', label: 'Contacts', icon: FiMail },
    { id: 'analytics', label: 'Analytics', icon: FiTrendingUp },
    { id: 'pricing', label: 'Pricing', icon: FiDollarSign, superOnly: true },
    { id: 'system', label: 'System Health', icon: FiActivity },
    { id: 'backups', label: 'Backups', icon: FiDatabase, superOnly: true },
    { id: 'audit', label: 'Audit Logs', icon: FiFileText }
  ].filter(tab => !tab.superOnly || isSuperAdmin);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardStats />;
      case 'users':
        return <UserManagement />;
      case 'contacts':
        return <ContactManagement />;
      case 'analytics':
        return <Analytics />;
      case 'pricing':
        return <PricingManager />;
      case 'system':
        return <SystemHealth />;
      case 'backups':
        return <BackupManager />;
      case 'audit':
        return <AuditLogs />;
      default:
        return <DashboardStats />;
    }
  };

  return (
    <div className="admin-page">
      {/* Admin Navbar */}
      <nav className="admin-navbar">
        <div className="container">
          <div className="navbar-content">
            {/* Logo & Brand */}
            <div className="navbar-brand">
              <FiShield className="brand-icon" />
              <span className="brand-text">Vayrex Admin</span>
              {/* <span className="role-badge">{user?.role}</span> */}
            </div>

            {/* Desktop Navigation */}
            <div className="navbar-tabs">
              {tabs.map(tab => {
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.id}
                    className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <IconComponent className="tab-icon" />
                    <span className="tab-label">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Right Actions */}
            <div className="navbar-actions">
              <button
                className="action-btn logout-btn"
                title="Logout"
                onClick={handleLogout}
              >
                <FiLogOut /> Logout
              </button>


              {/* Mobile Menu Toggle */}
              <button
                className="mobile-menu-btn"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <FiX /> : <FiMenu />}
              </button>
            </div>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="mobile-nav">
              {tabs.map(tab => {
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.id}
                    className={`mobile-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <IconComponent className="tab-icon" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
              <div className="mobile-nav-divider" />
              <button
                className="mobile-nav-item logout"
                onClick={handleLogout}
              >
                <FiLogOut className="tab-icon" />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Page Header */}
      <header className="admin-page-header">
        <div className="container">
          <div className="page-header-content">
            <div className="page-title-section">
              <h1>{tabs.find(t => t.id === activeTab)?.label}</h1>
              <p className="page-subtitle">
                {activeTab === 'dashboard' && 'Overview of your platform statistics and activity'}
                {activeTab === 'users' && 'Manage user accounts and permissions'}
                {activeTab === 'contacts' && 'View and respond to contact submissions'}
                {activeTab === 'analytics' && 'Detailed analytics and insights'}
                {activeTab === 'pricing' && 'Manage tier pricing and exchange rates'}
                {activeTab === 'system' && 'Monitor system performance and health'}
                {activeTab === 'backups' && 'Manage database backups and restoration'}
                {activeTab === 'audit' && 'View system activity and audit trail'}
              </p>
            </div>
            <div className="page-header-info">
              <span className="welcome-text">Welcome, {user?.username}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="admin-main-content">
        <div className="container">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;