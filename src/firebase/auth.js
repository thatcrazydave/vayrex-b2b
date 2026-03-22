import { 
  signInWithRedirect,
  getRedirectResult,
  signInWithPopup,
  signOut, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { auth, googleProvider } from './config.js';

// ===== HELPER: Convert Firebase user to app format =====
export const firebaseUserToAppUser = (firebaseUser) => {
  if (!firebaseUser) return null;
  
  return {
    id: firebaseUser.uid,
    email: firebaseUser.email,
    fullname: firebaseUser.displayName || firebaseUser.email.split('@')[0],
    username: firebaseUser.displayName || firebaseUser.email.split('@')[0],
    photoURL: firebaseUser.photoURL,
    provider: 'google'
  };
};

// ===== Google Sign In using popup =====
export const signInWithGoogle = async () => {
  if (!auth || !googleProvider) {
    throw new Error('Firebase is not properly configured. Please check your environment variables.');
  }
  
  try {
    let result;
    try {
      result = await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/popup-closed-by-user') {
        await signInWithRedirect(auth, googleProvider);
        return null;
      }
      throw err;
    }
    
    return result.user;
    
  } catch (error) {
    console.error('Firebase: Google sign in error:', error);
    throw error;
  }
};

// ===== Handle redirect result after Google sign in =====
export const handleGoogleRedirect = async () => {
  if (!auth) {
    return null;
  }
  
  try {
    const result = await getRedirectResult(auth);
    
    if (result) {

      return result.user;
    }
    
    return null;
  } catch (error) {
    console.error('Firebase: Google redirect error:', error);
    throw error;
  }
};

// ===== Email/Password Sign Up =====
export const signUpWithEmail = async (email, password, fullname, username) => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const user = result.user;
    
    // Update the user's display name
    await updateProfile(user, {
      displayName: fullname
    });
    return {
      id: user.uid,
      email: user.email,
      fullname: fullname,
      username: username,
      provider: 'email'
    };
  } catch (error) {
    console.error('Firebase: Email sign up error:', error);
    throw error;
  }
};

// ===== Email/Password Sign In =====
export const signInWithEmail = async (email, password) => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    const user = result.user;
    
    
    return {
      id: user.uid,
      email: user.email,
      fullname: user.displayName || user.email.split('@')[0],
      username: user.displayName || user.email.split('@')[0],
      provider: 'email'
    };
  } catch (error) {
    console.error('Firebase: Email sign in error:', error);
    throw error;
  }
};

// ===== Sign Out =====
export const signOutUser = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Firebase: Sign out error:', error);
    throw error;
  }
};

// ===== Auth State Listener =====
export const onAuthStateChange = (callback) => {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      callback({
        id: user.uid,
        email: user.email,
        fullname: user.displayName || user.email.split('@')[0],
        username: user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL,
        provider: user.providerData[0]?.providerId || 'email'
      });
    } else {
      callback(null);
    }
  });
};