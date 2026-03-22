import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getEnvConfig, showEnvSetupInstructions } from '../utils/envConfig.js';

// Get Firebase configuration
const envConfig = getEnvConfig();
const firebaseConfig = envConfig.config;

// Validate Firebase configuration
const isConfigValid = () => {
  if (!envConfig.isValid) {
    showEnvSetupInstructions(envConfig.missingVars);
    return false;
  }
  return true;
};


// Validate configuration before initializing Firebase
let app;
let auth;
let googleProvider;
let db;

try {
  if (!isConfigValid()) {
    console.error('  Firebase configuration is invalid. Please check the console for details.');
    // Create a mock app to prevent crashes
    app = null;
    auth = null;
    googleProvider = null;
    db = null;
  } else {
    // Initialize Firebase
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    db = getFirestore(app);
    
  }
} catch (error) {
  console.error('  Firebase initialization failed:', error);
  app = null;
  auth = null;
  googleProvider = null;
  db = null;
}

// Export Firebase services (will be null if initialization failed)
export { auth, googleProvider, db };
export default app;
