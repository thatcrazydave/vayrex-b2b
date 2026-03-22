import './styles/nav.css';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { FiLogOut } from 'react-icons/fi';
import { useAuth } from './contexts/AuthContext.jsx';

function Nav() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Scroll-aware nav elevation
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when menu is open
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

  const closeMenu = () => setIsOpen(false);

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
            {isAuthenticated ? (
              <>
                <li><Link to="/learn">Learn</Link></li>
                <li><Link to="/Upload">Upload</Link></li>
                <li><Link to="/Dashboard">Dashboard</Link></li>
                <li><Link to="/generate-quiz">Generate Quiz</Link></li>
                <li><Link to="/settings">Settings</Link></li>
                <li>
                  <button onClick={handleLogout} className="nav-cta" style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                    <FiLogOut size={14} /> Logout
                  </button>
                </li>
              </>
            ) : (
              <>
                <li><Link to="/about">About</Link></li>
                <li><Link to="/contact">Contact</Link></li>
                <li><Link to="/Login">Login</Link></li>
                <li><Link to="/Signup" className="nav-cta">Get Started</Link></li>
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
        {isAuthenticated ? (
          <>
            <Link to="/learn" onClick={closeMenu}>Learn</Link>
            <Link to="/Upload" onClick={closeMenu}>Upload</Link>
            <Link to="/Dashboard" onClick={closeMenu}>Dashboard</Link>
            <Link to="/generate-quiz" onClick={closeMenu}>Generate Quiz</Link>
            <Link to="/settings" onClick={closeMenu}>Settings</Link>
            <button onClick={handleLogout} className="mobile-cta">
              <FiLogOut size={16} /> Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/about" onClick={closeMenu}>About</Link>
            <Link to="/contact" onClick={closeMenu}>Contact</Link>
            <Link to="/Login" onClick={closeMenu}>Login</Link>
            <Link to="/Signup" onClick={closeMenu} className="mobile-cta">Get Started</Link>
          </>
        )}
      </div>
    </>
  );
}

export default Nav;
