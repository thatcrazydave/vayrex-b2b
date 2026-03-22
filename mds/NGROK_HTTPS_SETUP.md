# ngrok HTTPS Setup Guide

## 🎯 Purpose
Configure ngrok to provide HTTPS URLs for both frontend and backend, enabling proper CSRF token validation and secure cross-origin requests.

## 📋 Prerequisites

1. **Install ngrok** (if not already installed):
   ```bash
   # macOS
   brew install ngrok
   
   # Or download from: https://ngrok.com/download
   ```

2. **Get ngrok authtoken**:
   - Sign up at https://dashboard.ngrok.com/signup
   - Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken

## ⚙️ Configuration Steps

### 1. Add Your ngrok Authtoken

Update `ngrok.yml` with your actual authtoken:

```bash
# Edit ngrok.yml
nano ngrok.yml

# Replace YOUR_AUTHTOKEN_HERE with your actual token
```

Or use the CLI:
```bash
ngrok config add-authtoken YOUR_TOKEN_HERE
```

### 2. Start Backend Server

```bash
cd backend
npm start
```

Server should be running on `http://localhost:5001`

### 3. Start Frontend Dev Server

```bash
npm run dev
```

Frontend should be running on `http://localhost:5173`

### 4. Start ngrok Tunnels

```bash
# From the project root
./scripts/start-ngrok.sh

# Or manually
ngrok start --all --config ngrok.yml
```

### 5. Copy the HTTPS URLs

ngrok will display something like:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:5001  (backend)
Forwarding  https://xyz789.ngrok-free.app -> http://localhost:5173  (frontend)
```

### 6. Update Environment Variables

Update `backend/.env`:
```env
# Add your ngrok HTTPS URLs
CORS_ORIGINS=http://localhost:5173,https://YOUR_FRONTEND_NGROK.ngrok-free.app,https://vayrex.netlify.app
API_URL=https://YOUR_BACKEND_NGROK.ngrok-free.app
```

Update `src/.env.local` (create if doesn't exist):
```env
VITE_API_URL=https://YOUR_BACKEND_NGROK.ngrok-free.app/api
```

### 7. Restart Backend

```bash
cd backend
npm start
```

### 8. Test on Mobile

Open your frontend ngrok URL on your mobile device:
```
https://YOUR_FRONTEND_NGROK.ngrok-free.app
```

## ✅ Verification Checklist

- [ ] ngrok shows **HTTPS** URLs (not HTTP)
- [ ] Backend accepts requests from ngrok URLs
- [ ] CSRF token is successfully generated at `/api/csrf-token`
- [ ] Cookies are set with `Secure; SameSite=None`
- [ ] File upload works without CSRF errors
- [ ] Mobile app can upload files successfully

## 🔧 Troubleshooting

### Issue: "Invalid or missing CSRF token"

**Check:**
1. Are you using HTTPS URLs from ngrok? (not HTTP)
2. Is `withCredentials: true` set in axios?
3. Are cookies being sent? (Check DevTools → Network → Request Headers)
4. Is the `_csrf` cookie present? (Check DevTools → Application → Cookies)

### Issue: ngrok URLs change on restart

**Solution:**
- Free ngrok accounts get random URLs each time
- Upgrade to ngrok Pro for static URLs
- Or update env vars after each ngrok restart

### Issue: CORS errors

**Fix:**
1. Add your ngrok URL to `CORS_ORIGINS` in `backend/.env`
2. Restart backend server
3. Clear browser cache

## 📱 Testing Flow

1. **Desktop browser:**
   - Open: `https://YOUR_FRONTEND_NGROK.ngrok-free.app`
   - Upload a file
   - Should work without CSRF errors

2. **Mobile device:**
   - Open same ngrok URL
   - Upload a file
   - Should work with proper CSRF validation

##   Security Notes

- ngrok HTTPS tunnels provide valid SSL certificates
- Cookies with `Secure; SameSite=None` work properly over HTTPS
- CSRF protection is fully enabled in this configuration
- Never commit your ngrok authtoken to git

## 🚀 Production Deployment

For production (Netlify frontend + your backend):
- Use your actual HTTPS domain
- Configure proper SSL certificates
- Update CORS_ORIGINS with production URLs
- Keep `secure: true` and `sameSite: 'none'` in CSRF config

##  Configuration Summary

**Current ngrok.yml:**
```yaml
version: "2"
tunnels:
  backend:
    proto: http
    addr: 5001
    schemes:
      - https
    inspect: true
  
  frontend:
    proto: http
    addr: 5173
    schemes:
      - https
    inspect: true
```

**CSRF Configuration (server.js):**
```javascript
const csrfProtection = csrf({
  cookie: {
    key: '_csrf',
    httpOnly: true,
    secure: true,        // ✅ Works with HTTPS
    sameSite: 'none',    // ✅ Required for cross-origin
    maxAge: 3600000      // 1 hour
  }
});
```

## 🆘 Need Help?

Common issues are usually:
1. Forgot to add authtoken to ngrok.yml
2. Using HTTP ngrok URL instead of HTTPS
3. Didn't update CORS_ORIGINS after getting new ngrok URLs
4. Didn't restart backend after env changes
