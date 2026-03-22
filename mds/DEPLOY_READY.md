#   YOUR FRONTEND IS READY FOR NETLIFY!

##   What's Been Configured

  **netlify.toml** - Netlify configuration file  
  **.env.production** - Production environment variables  
  **Backend CORS** - Updated to accept Netlify requests  
  **Build** - Compiled to `dist/` folder  
  **deploy-netlify.sh** - Quick deployment script  

---

##  Quick Deploy (3 Steps)

### Step 1: Install Netlify CLI (One-time)
```bash
npm install -g netlify-cli
```

### Step 2: Deploy
```bash
./deploy-netlify.sh
```

Or manually:
```bash
netlify deploy --prod
```

### Step 3: Set Environment Variables in Netlify

After first deployment, go to Netlify Dashboard:

**Site settings → Environment variables → Add variables:**

```
VITE_API_URL = http://192.168.0.199:5001/api
VITE_FIREBASE_API_KEY = AIzaSyDtcGw6lZJ2Nzl74z6H8TugpyzEIYT5WX0
VITE_FIREBASE_AUTH_DOMAIN = veyrax-4def7.firebaseapp.com
VITE_FIREBASE_PROJECT_ID = veyrax-4def7
VITE_FIREBASE_STORAGE_BUCKET = veyrax-4def7.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID = 522811795047
VITE_FIREBASE_APP_ID = 1:522811795047:web:9572b1cc72cdabf942d6c2
```

Then **redeploy**: `netlify deploy --prod`

---

## 🖥️ Running Backend on Your Laptop

### Start Backend
```bash
cd backend
npm start
```

**Keep this terminal running!**

### Verify Backend is Running
```bash
curl http://192.168.0.199:5001/api
```

---

##  Alternative: Use ngrok (Easier)

If your local IP doesn't work (firewall, NAT issues):

### 1. Install ngrok
```bash
brew install ngrok
```

### 2. Create tunnel
```bash
ngrok http 5001
```

You'll get: `https://abc123.ngrok.io`

### 3. Update Netlify environment variable
```
VITE_API_URL = https://abc123.ngrok.io/api
```

### 4. Update backend CORS
Add ngrok URL to `backend/.env`:
```
CORS_ORIGINS=http://localhost:5173,https://*.netlify.app,https://abc123.ngrok.io
```

### 5. Redeploy
```bash
netlify deploy --prod
```

---

##   Important Notes

### Before Testing:
- [ ] Backend is running: `cd backend && npm start`
- [ ] MongoDB is running
- [ ] Redis is running (if used)
- [ ] Laptop is on the same WiFi
- [ ] Laptop won't go to sleep

### Your Configuration:
- **Local IP:** `192.168.0.199`
- **Backend Port:** `5001`
- **Frontend API URL:** `http://192.168.0.199:5001/api`
- **Build Folder:** `dist/`

### Common Issues:

**"Failed to fetch" errors:**
- Check backend is running
- Verify CORS settings
- Try ngrok if local IP doesn't work

**CORS errors:**
- Restart backend after changing CORS
- Check Netlify URL is in CORS_ORIGINS

**Environment variables not working:**
- Set them in Netlify Dashboard
- Redeploy after setting
- Check they start with `VITE_`

---

##  Complete Workflow

```bash
# Terminal 1: Backend
cd backend
npm start

# Terminal 2: Deploy Frontend
./deploy-netlify.sh

# Or step by step:
npm run build
netlify deploy --prod
```

---

##   Useful Commands

```bash
# Build frontend
npm run build

# Deploy to Netlify
netlify deploy --prod

# Preview deployment
netlify deploy

# Open Netlify dashboard
netlify open

# View site logs
netlify logs

# Start backend
cd backend && npm start

# Get your local IP
ipconfig getifaddr en0

# Test backend
curl http://192.168.0.199:5001/api
```

---

##   You're All Set!

Your frontend is configured and ready to deploy to Netlify while your backend runs locally on your laptop.

**Next:** Run `./deploy-netlify.sh` to deploy!
