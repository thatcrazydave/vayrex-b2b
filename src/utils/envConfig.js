// Environment configuration helper
export const getEnvConfig = () => {
  const requiredEnvVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN', 
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
  ];

  const missingVars = requiredEnvVars.filter(varName => {
    const value = import.meta.env[varName];
    return !value || value.includes('your-') || value === '123456789';
  });

  return {
    isValid: missingVars.length === 0,
    missingVars,
    config: {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    }
  };
};

// Helper to show environment setup instructions
export const showEnvSetupInstructions = (missingVars) => {
  console.group(' Firebase Environment Setup Required');
  console.log('Missing or invalid environment variables:', missingVars);
  console.log('');
  console.log('Please create a .env file in your project root with:');
  console.log('');
  missingVars.forEach(varName => {
    console.log(`${varName}=your-actual-value-here`);
  });
  console.log('');
  console.log('You can find these values in Firebase Console > Project Settings > General');
  console.groupEnd();
};
