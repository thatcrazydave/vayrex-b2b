import React from 'react';

const LoadingSpinner = ({ message = "Loading..." }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      gap: '1.5rem'
    }}>
      {/* Morphing bars loader */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        height: '48px'
      }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              width: '6px',
              height: '48px',
              background: '#000',
              borderRadius: '3px',
              animation: `barPulse 1.2s ease-in-out ${i * 0.1}s infinite`
            }}
          />
        ))}
      </div>
      <p style={{
        color: '#666',
        fontSize: '0.95rem',
        fontWeight: 500,
        letterSpacing: '0.5px',
        margin: 0
      }}>
        {message}
      </p>
      <style>{`
        @keyframes barPulse {
          0%, 100% { transform: scaleY(0.4); opacity: 0.3; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default LoadingSpinner;
