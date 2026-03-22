import React from 'react';
import '../styles/pageLoader.css';

const PageLoader = () => {
  return (
    <div className="page-loader">
      <div className="page-loader-bars">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="page-loader-bar" style={{ animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
      <p className="page-loader-text">Loading...</p>
    </div>
  );
};

export default PageLoader;
