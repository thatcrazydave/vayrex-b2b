# Firebase Configuration Fix Guide

## The Problem
You're getting a `400 Bad Request` error because your Firebase configuration is using placeholder values instead of actual Firebase project credentials.

## The Solution

### Step 1: Create a Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project" or select an existing project
3. Follow the setup wizard

### Step 2: Get Your Firebase Configuration
1. In Firebase Console, go to **Project Settings** (gear icon)
2. Scroll down to **Your apps** section
3. Click **Add app** and select **Web** (</>) if you haven't already
4. Register your app with a nickname
5. Copy the configuration object that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

### Step 3: Create Environment File
Create a `.env` file in your project root with the following content:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your-actual-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

**Replace the placeholder values with your actual Firebase configuration values.**

### Step 4: Enable Authentication
1. In Firebase Console, go to **Authentication** > **Sign-in method**
2. Enable **Google** as a sign-in provider
3. Add your domain to **Authorized domains** if needed

### Step 5: Restart Your Development Server
After creating the `.env` file, restart your development server:

```bash
npm run dev
# or
yarn dev
```

## What I Fixed
-   Added configuration validation to detect placeholder values
-   Added clear error messages with instructions
-   Updated the config to prevent Firebase initialization with invalid credentials

## Expected Result
After following these steps, you should see:
-   All Firebase config fields showing "Set" instead of "Missing"
-   No more 400 Bad Request errors
-   Successful Firebase initialization
-   Google authentication working properly

## Troubleshooting
If you still see errors:
1. Double-check that your `.env` file is in the project root
2. Ensure all environment variables start with `VITE_`
3. Restart your development server after making changes
4. Check that your Firebase project has Authentication enabled
