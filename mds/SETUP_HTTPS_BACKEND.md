# Setting Up HTTPS for Local Backend

## Problem
Your Netlify site (HTTPS) cannot connect to your local backend (HTTP) due to browser mixed content security.

## Solution: Use ngrok to create HTTPS tunnel

### Step 1: Set up ngrok account

1. Go to https://ngrok.com/signup (it's free!)
2. Sign up with your email
3. After signup, go to https://dashboard.ngrok.com/get-started/setup
4. Copy your authtoken

### Step 2: Configure ngrok

Run this command with YOUR authtoken:
```bash
ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
```

### Step 3: Start ngrok tunnel

```bash
ngrok http 5001
```

You'll see output like:
```
Forwarding    https://abc123.ngrok-free.app -> http://localhost:5001
```

### Step 4: Update Netlify environment variable

1. Copy the ngrok URL (e.g., `https://abc123.ngrok-free.app`)
2. Go to Netlify Dashboard: https://app.netlify.com/projects/vayrex/settings/env
3. Update `VITE_API_URL` to: `https://abc123.ngrok-free.app/api`
4. Click "Save"
5. Trigger redeploy:
   ```bash
   netlify deploy --prod
   ```

### Step 5: Add Netlify domain to Firebase

1. Go to Firebase Console: https://console.firebase.google.com
2. Select your project: `veyrax-4def7`
3. Go to **Authentication** → **Settings** → **Authorized domains**
4. Click "Add domain"
5. Add: `vayrex.netlify.app`
6. Click "Save"

---

##   After completing these steps:

1. Your backend will be accessible over HTTPS via ngrok
2. No more mixed content errors
3. CORS will work (I've already configured it)
4. Firebase authentication will work

## 🔄 Every time you start developing:

1. Start backend: `cd backend && npm start`
2. Start ngrok: `ngrok http 5001`
3. If ngrok URL changes, update Netlify env variable and redeploy

## Alternative: Deploy Backend to Cloud

If you don't want to use ngrok, you can deploy your backend to:
- Railway (free tier)
- Render (free tier)
- Heroku (paid)
- AWS EC2/Elastic Beanstalk
- DigitalOcean

Would you like help with cloud deployment instead?
