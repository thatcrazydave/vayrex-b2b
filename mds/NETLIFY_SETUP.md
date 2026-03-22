#  Netlify + Local Backend Setup Guide

## Quick Start

### Step 1: Get Your Local IP Address

Run this command to find your local IP:
```bash
# On macOS/Linux
ipconfig getifaddr en0

# Or use this to see all network info
ifconfig | grep "inet " | grep -v 127.0.0.1

# On Windows
ipconfig
```

Your local IP will be something like: `192.168.1.100`

### Step 2: Update Backend CORS

Your backend `.env` already has CORS_ORIGINS. You need to:

1. **Get your Netlify site URL** (you'll get this after deploying, e.g., `https://your-app.netlify.app`)

2. **Update `backend/.env` with your Netlify URL:**
```env
CORS_ORIGINS=http://localhost:5173,http://localhost:5174,https://your-app.netlify.app
```

### Step 3: Deploy to Netlify

#### Option A: Using Netlify CLI (Recommended)

```bash
# Install Netlify CLI globally
npm install -g netlify-cli

# Login to Netlify
netlify login

# Initialize and deploy
netlify init

# Follow prompts:
# - Create & configure a new site
# - Build command: npm run build
# - Publish directory: dist

# Deploy
netlify deploy --prod
```

#### Option B: Using Netlify Dashboard

1. Go to [app.netlify.com](https://app.netlify.com)
2. Click "Add new site" > "Import an existing project"
3. Connect your Git repository (or drag & drop your `dist` folder)
4. Configure:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Click "Deploy site"

### Step 4: Set Environment Variables on Netlify

After deployment, set environment variables:

1. Go to **Site settings** > **Environment variables**
2. Add these variables:
   ```
   VITE_API_URL = http://YOUR_LOCAL_IP:5001/api
   VITE_FIREBASE_API_KEY = AIzaSyDtcGw6lZJ2Nzl74z6H8TugpyzEIYT5WX0
   VITE_FIREBASE_AUTH_DOMAIN = veyrax-4def7.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID = veyrax-4def7
   VITE_FIREBASE_STORAGE_BUCKET = veyrax-4def7.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID = 522811795047
   VITE_FIREBASE_APP_ID = 1:522811795047:web:9572b1cc72cdabf942d6c2
   ```

3. Replace `YOUR_LOCAL_IP` with your actual local IP (e.g., `192.168.1.100`)

### Step 5: Start Your Backend Locally

```bash
# Terminal 1: Start backend
cd backend
npm start

# You should see:
#   Server running on http://localhost:5001
#   MongoDB connected
```

**Important:** Keep your laptop on the same WiFi network!

### Step 6: Test the Connection

1. Visit your Netlify site: `https://your-app.netlify.app`
2. Try logging in or making an API call
3. Check backend terminal for incoming requests

---

##  Alternative: Use ngrok for Easier Setup

If the local IP method doesn't work (firewall, NAT, etc.), use ngrok:

### Install ngrok
```bash
# macOS
brew install ngrok

# Or download from ngrok.com
```

### Create a tunnel
```bash
# Expose your local backend
ngrok http 5001
```

You'll get a URL like: `https://abc123.ngrok.io`

### Update Netlify Environment Variables
```
VITE_API_URL = https://abc123.ngrok.io/api
```

### Update Backend CORS
```env
CORS_ORIGINS=http://localhost:5173,https://your-app.netlify.app,https://abc123.ngrok.io
```

Redeploy to Netlify:
```bash
netlify deploy --prod
```

---

##   Pre-Deployment Checklist

- [ ] Build works locally: `npm run build`
- [ ] Backend running: `npm start` in backend folder
- [ ] MongoDB running locally
- [ ] Redis running locally (if used)
- [ ] Got your local IP or ngrok URL
- [ ] Updated CORS_ORIGINS in backend/.env
- [ ] Environment variables set on Netlify

---

##  Troubleshooting

### Frontend can't connect to backend
- Check if backend is running: `curl http://localhost:5001/api`
- Verify CORS includes your Netlify URL
- Check firewall settings
- Try ngrok if local IP doesn't work

### CORS errors
- Update `CORS_ORIGINS` in `backend/.env`
- Restart backend after changing CORS
- Clear browser cache

### Build fails on Netlify
- Check build logs in Netlify dashboard
- Ensure all dependencies are in package.json
- Test build locally: `npm run build`

### API calls fail
- Check browser console for errors
- Verify `VITE_API_URL` is correct
- Test backend directly: `curl http://YOUR_IP:5001/api`

---

##   Security Notes

**Warning:** Exposing your local backend to the internet is for testing only!

- Don't expose sensitive data
- Use ngrok's password protection if needed
- Don't commit `.env` files
- For production, deploy backend to a proper hosting service

---

##   Testing from Mobile

If you want to test on your phone:

1. Connect phone to same WiFi
2. Visit: `https://your-app.netlify.app`
3. Backend must be running on your laptop
4. Make sure laptop doesn't sleep!

---

##  Quick Commands

```bash
# Build frontend
npm run build

# Deploy to Netlify
netlify deploy --prod

# Start backend
cd backend && npm start

# Create ngrok tunnel
ngrok http 5001

# Get your local IP
ipconfig getifaddr en0
```
