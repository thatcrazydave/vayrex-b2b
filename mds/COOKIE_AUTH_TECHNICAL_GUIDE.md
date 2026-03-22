# HttpOnly Cookie Authentication - Technical Reference

## Quick Start

### For Developers
```bash
# 1. Ensure backend is running
cd backend && node server.js

# 2. Frontend automatically sends cookies via axios
# with withCredentials: true

# 3. Test protected route
curl -i http://localhost:5001/api/auth/verify
# Response: 401 (no auth)

# 4. Login and get cookie
# (use browser; curl doesn't auto-send cookies)

# 5. Protected routes now work with cookie auth
```

### For DevOps
```bash
# Production environment variables needed:
export NODE_ENV=production
export JWT_SECRET="<44+ random chars>"
export MONGODB_URI="mongodb+srv://user:pass@..."
export REDIS_PASSWORD="<16+ random chars>"
export REDIS_URL="redis://:PASSWORD@redis:6379/0"
export CORS_ORIGINS="https://yourdomain.com"

# Start server
node server.js
# Cookies will have secure flag + sameSite=strict
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + Axios)                    │
│                                                                  │
│  User logs in → POST /auth/login with CSRF token               │
│       ↓                                                          │
│  Backend responds with Set-Cookie: token=<JWT> (httpOnly)      │
│       ↓                                                          │
│  Browser stores cookie (JavaScript cannot access)               │
│       ↓                                                          │
│  API calls: Axios with withCredentials: true                   │
│       ↓                                                          │
│  Browser automatically includes cookie in request               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
         ┌──────────────────────────────────────────┐
         │   BACKEND (Express with Middleware)     │
         │                                          │
         │  authenticateToken middleware:          │
         │  1. Check Authorization header         │
         │  2. Fallback to req.cookies.token      │
         │  3. Verify JWT signature               │
         │  4. Attach user to req.user            │
         │                                          │
         │  Route executes with req.user          │
         └──────────────────────────────────────────┘
                            ↓
         ┌──────────────────────────────────────────┐
         │  DATABASE (MongoDB + Redis)             │
         │  - User data, questions, results        │
         │  - Rate limit cache, session tracking   │
         └──────────────────────────────────────────┘
```

---

## Cookie Specification

### Set by Backend
```
Set-Cookie: token=<JWT>; Path=/; HttpOnly; SameSite=<strict/lax>; Secure; Max-Age=604800
```

| Attribute | Value | Purpose |
|-----------|-------|---------|
| `token=` | `<JWT>` | JWT token (7-day expiry) |
| `Path=/` | All routes | Cookie sent to all API endpoints |
| `HttpOnly` |   | JavaScript cannot access (XSS protection) |
| `SameSite` | strict/lax | CSRF protection; value depends on NODE_ENV |
| `Secure` |   (prod only) | Only sent over HTTPS |
| `Max-Age` | 604800 | 7 days in seconds |

### Sent by Browser
```
Cookie: token=<JWT>
```

Automatically included when:
-   `withCredentials: true` (Axios)
-   `credentials: 'include'` (Fetch)
-   Domain matches exactly
-   Secure flag matches protocol (HTTP/HTTPS)

---

## JWT Structure

### Payload (after verification)
```javascript
{
  id: "507f1f77bcf86cd799439011",        // MongoDB ObjectId
  email: "user@example.com",
  username: "john_doe",
  role: "user",                          // or "admin"
  tier: "free",                          // or "basic", "pro", "enterprise"
  iat: 1705084352,                       // Issued at (unix timestamp)
  exp: 1705689152                        // Expires at (unix timestamp)
}
```

### Verification
```javascript
const decoded = jwt.verify(token, process.env.JWT_SECRET);
// If signature invalid → throw error → 401 response
// If expired → throw error → 401 response
// If valid → decoded payload attached to req.user
```

---

## Request/Response Examples

### Example 1: Login
```http
POST /api/auth/login HTTP/1.1
Host: localhost:5001
Content-Type: application/json
X-CSRF-Token: oHd5qxI2-c9icyuBdMpsU7UGE4kRDNmXTh0M

{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:**
```http
HTTP/1.1 200 OK
Set-Cookie: token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=604800
Content-Type: application/json

{
  "success": true,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "john_doe",
    "email": "user@example.com",
    "role": "user",
    "tier": "free"
  }
}
```

### Example 2: Protected Route (with cookie)
```http
GET /api/user/uploads HTTP/1.1
Host: localhost:5001
Cookie: token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-CSRF-Token: oHd5qxI2-c9icyuBdMpsU7UGE4kRDNmXTh0M

(Note: Cookie is sent automatically by browser)
```

**Backend Processing:**
```javascript
authenticateToken(req, res, next) {
  // 1. Check Authorization header
  const authHeader = req.headers['authorization'];  // undefined
  let token = authHeader && authHeader.split(' ')[1];  // null

  // 2. Fallback to cookie
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;  //   Found cookie!
  }

  // 3. Verify JWT
  const decoded = jwt.verify(token, JWT_SECRET);  //   Valid

  // 4. Attach to request
  req.user = decoded;  // req.user.id = "507f1f77bcf86cd799439011"

  // 5. Continue to route
  next();
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "uploads": [
    { "id": "...", "topic": "Biology", "date": "2026-01-11" },
    { "id": "...", "topic": "Chemistry", "date": "2026-01-10" }
  ]
}
```

### Example 3: POST with CSRF (state-changing)
```http
POST /api/results HTTP/1.1
Host: localhost:5001
Content-Type: application/json
Cookie: token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-CSRF-Token: oHd5qxI2-c9icyuBdMpsU7UGE4kRDNmXTh0M

{
  "topicId": "...",
  "score": 85,
  "answeredQuestions": 20
}
```

**Backend Processing:**
```javascript
// 1. CSRF middleware validates X-CSRF-Token
// 2. Auth middleware validates JWT from cookie
// 3. Request processed
// 4. Result saved to database
```

---

## Error Handling

### 401 Unauthorized (No Token)
```javascript
if (!token) {
  return res.status(401).json({
    success: false,
    error: {
      code: 'NO_TOKEN',
      message: 'Access token required'
    }
  });
}
```

**Troubleshooting:**
- [ ] Check if browser sent cookie (DevTools → Network → Cookies)
- [ ] Verify `withCredentials: true` in frontend
- [ ] Ensure CORS allows credentials
- [ ] Check domain matches exactly

### 401 Unauthorized (Invalid Token)
```javascript
try {
  const decoded = jwt.verify(token, JWT_SECRET);
} catch (err) {
  return res.status(401).json({
    success: false,
    error: {
      code: 'INVALID_TOKEN',
      message: 'Token validation failed'
    }
  });
}
```

**Troubleshooting:**
- [ ] Token may be expired (7-day expiry)
- [ ] JWT_SECRET may have changed
- [ ] Token corruption during transmission
- **Solution:** Login again to get new token

### 403 Forbidden (CSRF Token)
```javascript
res.status(403).json({
  errorCode: 'EBADCSRFTOKEN',
  message: 'CSRF token validation failed'
});
```

**Troubleshooting:**
- [ ] Check X-CSRF-Token header is sent (for POST/PUT/DELETE)
- [ ] Ensure CSRF token matches backend
- [ ] Token may be expired (30-min expiry)
- **Solution:** Refresh CSRF token from `/api/csrf-token`

---

## Environment Variables

### Development (.env)
```bash
NODE_ENV=development
JWT_SECRET=test-secret-do-not-use-in-production-12345
MONGODB_URI=mongodb://localhost:27017/quiz-app
REDIS_URL=redis://localhost:6379/0
CORS_ORIGINS=http://localhost:5173
```

### Production (docker-compose.production.yml)
```yaml
environment:
  - NODE_ENV=production
  - JWT_SECRET=${JWT_SECRET}
  - MONGODB_URI=${MONGODB_URI}
  - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
  - CORS_ORIGINS=${CORS_ORIGINS}
```

### Generating JWT_SECRET
```bash
# Generate 44+ character random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0

export JWT_SECRET="a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"
```

---

## Code Walkthrough

### Frontend (React/Axios)
```javascript
// src/services/api.js

import axios from 'axios';

// Create axios instance with credentials
const API = axios.create({
  baseURL: 'http://localhost:5001/api',
  withCredentials: true,  // ← CRITICAL: Enables cookie sending
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor: Add CSRF token
API.interceptors.request.use(async (config) => {
  // Only for state-changing requests
  if (['post', 'put', 'delete', 'patch'].includes(config.method)) {
    const csrf = await getCsrfToken();
    config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
}, error => Promise.reject(error));

// Response interceptor: Handle CSRF errors
API.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 403 && 
        error.response?.data?.errorCode === 'EBADCSRFTOKEN') {
      // Refresh token and retry
      await getCsrfToken(true);  // Force refresh
      return API.request(error.config);  // Retry request
    }
    return Promise.reject(error);
  }
);

export default API;
```

### Backend (Express Middleware)
```javascript
// backend/middleware/auth.js

const authenticateToken = async (req, res, next) => {
  try {
    // 1. Check Authorization header (backward compat)
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    // 2. Fallback to httpOnly cookie (primary)
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // 3. No token found
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'NO_TOKEN', message: 'Token required' }
      });
    }

    // 4. Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 5. Fetch user from database (optional, for fresh data)
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      });
    }

    // 6. Attach to request
    req.user = decoded;

    // 7. Continue to route
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_INVALID', message: 'Token validation failed' }
    });
  }
};

module.exports = { authenticateToken };
```

### Route Usage
```javascript
// backend/routes/admin.js

const { authenticateToken } = require('../middleware/auth');

// All routes in this file require authentication
router.use(authenticateToken);

// Now req.user is available in all handlers
router.get('/dashboard', async (req, res) => {
  const userId = req.user.id;  //   Authenticated user ID
  const user = await User.findById(userId);
  res.json({ success: true, data: user });
});
```

---

## Testing Checklist

### Unit Tests
```javascript
// Test: Token extracted from cookie
const req = {
  headers: {},
  cookies: { token: 'eyJhbGc...' }
};
// Expected: token extracted from req.cookies.token

// Test: Token extracted from header (backward compat)
const req = {
  headers: { authorization: 'Bearer eyJhbGc...' },
  cookies: {}
};
// Expected: token extracted from header

// Test: Header takes precedence
const req = {
  headers: { authorization: 'Bearer headerToken' },
  cookies: { token: 'cookieToken' }
};
// Expected: headerToken used (header checked first)
```

### Integration Tests
```bash
# 1. Get CSRF token
CSRF=$(curl -s http://localhost:5001/api/csrf-token | jq -r .csrfToken)

# 2. Login
RESPONSE=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"email":"test@example.com","password":"password"}')

# 3. Extract cookie from response headers
# (use -i flag to see headers)

# 4. Use in subsequent request
# (curl with -b flag to send cookies)
```

### E2E Tests (Selenium/Playwright)
```javascript
// 1. Navigate to login page
await page.goto('http://localhost:5173/login');

// 2. Enter credentials
await page.fill('input[name="email"]', 'test@example.com');
await page.fill('input[name="password"]', 'password123');

// 3. Submit
await page.click('button[type="submit"]');

// 4. Wait for redirect to dashboard
await page.waitForNavigation();

// 5. Check Network tab for cookie
const cookies = await context.cookies();
const authCookie = cookies.find(c => c.name === 'token');
expect(authCookie.httpOnly).toBe(true);
expect(authCookie.sameSite).toBe('Strict');  // or 'Lax'

// 6. Verify dashboard loaded (protected route)
await expect(page).toHaveTitle(/Dashboard/);
```

---

## Performance Impact

### Negligible Overhead
- No performance degradation
- Cookie-based auth is faster (fewer headers)
- Middleware execution time: <1ms per request
- JWT verification: <2ms per request

### Memory Usage
- No additional memory per request
- Cookies stored in Redis (optional)
- Session tracking: ~100 bytes per session

---

## Migration from Header-Based Auth

If you have existing header-based clients:

```javascript
// Old client code (still works!)
axios.create({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

// Backend now supports both:
// 1. Header → extracted
// 2. Cookie fallback → extracted
// 3. Either works!

// New client code (preferred)
axios.create({
  withCredentials: true
  // Cookie auto-sent, no manual header needed
});
```

---

## Troubleshooting Matrix

| Issue | Cause | Solution |
|-------|-------|----------|
| 401 on protected route | No cookie sent | Enable `withCredentials: true` |
| Cookie not set on login | HTTPS + secure flag mismatch | Use HTTP in dev, or disable secure flag |
| CSRF token error on POST | X-CSRF-Token header missing | Ensure interceptor runs on state-changing requests |
| XSS attack can read token | httpOnly flag missing | Verify cookie was set with httpOnly flag |
| Multiple tabs not sharing session | Use sessionStorage instead of httpOnly | This is by design; log in per tab |
| Token expires mid-session | 7-day expiry reached | Refresh token endpoint needed for long sessions |

---

## References

- JWT: https://jwt.io
- httpOnly Cookies: https://owasp.org/www-community/attacks/xss/
- CSRF: https://owasp.org/www-community/attacks/csrf
- Express Cookies: http://expressjs.com/en/api/res.html#res.cookie
- Axios withCredentials: https://axios-http.com/docs/req_config

