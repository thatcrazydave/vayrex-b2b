import './styles/nav.css';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { FiLogOut, FiGrid, FiUsers, FiUser, FiBook, FiCalendar, FiChevronDown, FiZap } from 'react-icons/fi';
import { useAuth } from './contexts/AuthContext.jsx';

// Role → nav links (per master plan Section 12 routes)
const ROLE_NAV = {
  owner: [
    { to: '/org-admin', label: 'Dashboard', icon: FiGrid },
    { to: '/org-admin/members', label: 'Members', icon: FiUsers },
    { to: '/org-admin/classes', label: 'Classes', icon: FiBook },
    { to: '/org-admin/academic', label: 'Calendar', icon: FiCalendar },
  ],
  org_admin: [
    { to: '/org-admin', label: 'Dashboard', icon: FiGrid },
    { to: '/org-admin/members', label: 'Members', icon: FiUsers },
    { to: '/org-admin/classes', label: 'Classes', icon: FiBook },
    { to: '/org-admin/academic', label: 'Calendar', icon: FiCalendar },
  ],
  it_admin: [
    { to: '/org-admin', label: 'Dashboard', icon: FiGrid },
    { to: '/org-admin/classes', label: 'Classes', icon: FiBook },
    { to: '/org-admin/academic', label: 'Calendar', icon: FiCalendar },
  ],
  teacher: [
    { to: '/teacher', label: 'Dashboard', icon: FiGrid },
    { to: '/teacher/gradebook', label: 'Grade Book', icon: FiBook },
  ],
  student: [
    { to: '/student', label: 'Dashboard', icon: FiGrid },
  ],
  guardian: [
    { to: '/guardian-portal', label: 'My Child', icon: FiUser },
  ],
};

const QUICK_ACTIONS = {
  owner: [
    { to: '/org-admin/members', label: 'Manage Members' },
    { to: '/org-admin/classes', label: 'Classes' },
    { to: '/org-admin/academic', label: 'Calendar' },
    { to: '/org-admin/gradebook', label: 'Grade Book' },
    { to: '/org-admin/report-cards', label: 'Report Cards' },
    { to: '/org-admin/announcements', label: 'Announcements' },
  ],
  org_admin: [
    { to: '/org-admin/members', label: 'Manage Members' },
    { to: '/org-admin/classes', label: 'Classes' },
    { to: '/org-admin/academic', label: 'Calendar' },
    { to: '/org-admin/gradebook', label: 'Grade Book' },
    { to: '/org-admin/report-cards', label: 'Report Cards' },
    { to: '/org-admin/announcements', label: 'Announcements' },
  ],
  teacher: [
    { to: '/teacher/gradebook', label: 'Grade Book' },
    { to: '/teacher/upload', label: 'Upload Material' },
    { to: '/teacher/assignments', label: 'New Assignment' },
    { to: '/teacher/attendance', label: 'Mark Attendance' },
    { to: '/teacher/announcements', label: 'Announcements' },
  ],
};

function Nav() {
  const [isOpen, setIsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Close dropdown if clicking outside (simple approach: close on scroll)
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
      setActionsOpen(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('menu-open');
    } else {
      document.body.classList.remove('menu-open');
    }
    return () => document.body.classList.remove('menu-open');
  }, [isOpen]);

  const handleLogout = () => {
    logout();
    setIsOpen(false);
    navigate('/');
  };

  const closeMenu = () => {
    setIsOpen(false);
    setActionsOpen(false);
  };

  const roleLinks = (isAuthenticated && user?.orgRole) ? (ROLE_NAV[user.orgRole] || []) : [];
  const quickLinks = (isAuthenticated && user?.orgRole) ? (QUICK_ACTIONS[user.orgRole] || []) : [];

  return (
    <>
      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-container">
          <Link to="/" className="nav-logo">
            <span className="nav-logo-mark">V</span>
            Vayrex
          </Link>

          {/* Desktop Links */}
          <ul className="nav-links">
            {isAuthenticated && user?.orgRole ? (
              <>
                {roleLinks.map(({ to, label }) => (
                  <li key={to}><Link to={to}>{label}</Link></li>
                ))}
                {quickLinks.length > 0 && (
                  <li style={{ position: 'relative' }}>
                    <button 
                      className="nav-cta-action" 
                      onClick={() => setActionsOpen(!actionsOpen)}
                    >
                      <FiZap size={14} fill="currentColor" /> Actions <FiChevronDown size={14} style={{ transform: actionsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                    </button>
                    {actionsOpen && (
                      <div style={{
                        position: 'absolute',
                        top: '110%',
                        right: 0,
                        background: '#ffffff',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: 'var(--shadow-md)',
                        padding: '0.5rem',
                        minWidth: '200px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        zIndex: 100
                      }}>
                        {quickLinks.map(({ to, label }) => (
                          <Link 
                            key={to} 
                            to={to} 
                            onClick={closeMenu}
                            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', transition: 'background 0.2s', display: 'block' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--background-light)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            {label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                )}
                <li style={{ marginLeft: '1rem' }}>
                  <button onClick={handleLogout} className="nav-cta" style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                    <FiLogOut size={14} /> Logout
                  </button>
                </li>
              </>
            ) : (
              <>
                <li><Link to="/about">About</Link></li>
                <li><Link to="/pricing">Pricing</Link></li>
                <li><Link to="/Login">Login</Link></li>
                <li><Link to="/org-signup" className="nav-cta">Get Started</Link></li>
              </>
            )}
          </ul>

          {/* Hamburger */}
          <button
            className={`hamburger ${isOpen ? 'open' : ''}`}
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </nav>

      {/* Mobile Menu overlay */}
      <div className={`mobile-menu ${isOpen ? 'open' : ''}`}>
        {isAuthenticated && user?.orgRole ? (
          <>
            {roleLinks.map(({ to, label }) => (
              <Link key={to} to={to} onClick={closeMenu}>{label}</Link>
            ))}
            {quickLinks.length > 0 && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Quick Actions</span>
                {quickLinks.map(({ to, label }) => (
                  <Link key={to} to={to} onClick={closeMenu} style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{label}</Link>
                ))}
              </div>
            )}
            <button onClick={handleLogout} className="mobile-cta" style={{ marginTop: '1.5rem' }}>
              <FiLogOut size={16} /> Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/about" onClick={closeMenu}>About</Link>
            <Link to="/pricing" onClick={closeMenu}>Pricing</Link>
            <Link to="/Login" onClick={closeMenu}>Login</Link>
            <Link to="/org-signup" onClick={closeMenu} className="mobile-cta">Get Started</Link>
          </>
        )}
      </div>
    </>
  );
}

export default Nav;
