# CI/CD Architecture Diagram

## Deployment Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     FEATURE DEVELOPMENT                         │
└─────────────────────────────────────────────────────────────────┘
           ↓
    Developer creates branch:
    git checkout -b feature/xyz develop
           ↓
    Make changes & commit
    git push origin feature/xyz
           ↓
┌─────────────────────────────────────────────────────────────────┐
│           GITHUB ACTIONS: PR CHECKS (Automatic)                 │
├─────────────────────────────────────────────────────────────────┤
│  ✓ Lint (ESLint)                                               │
│  ✓ Build Frontend (Vite)                                       │
│  ✓ Validate Backend (Node.js)                                  │
│  ✓ Security Scan (Trufflehog)                                  │
│  ✓ npm Audit                                                   │
│  ✓ Change detection                                            │
└─────────────────────────────────────────────────────────────────┘
           ↓
    Create PR on GitHub
           ↓
    Team reviews & approves
           ↓
┌─────────────────────────────────────────────────────────────────┐
│           GITHUB ACTIONS: LINT & TEST (Automatic)               │
├─────────────────────────────────────────────────────────────────┤
│  Runs on: Push to any branch                                   │
│  Jobs:                                                         │
│    • lint-frontend ──────────────┐                             │
│    • lint-backend ───────────────┤                             │
│    • test-frontend ──┐           ├─→ summary job               │
│    • build-frontend ─┤           │                             │
│    • build-backend ──┤           │                             │
│    • security-check ─┤           │                             │
│    • dependency-check┴───────────┘                             │
└─────────────────────────────────────────────────────────────────┘
           ↓
    Merge PR to develop
           ↓
┌─────────────────────────────────────────────────────────────────┐
│        GITHUB ACTIONS: DEPLOY TO STAGING (Automatic)            │
├─────────────────────────────────────────────────────────────────┤
│  Trigger: Push to develop branch                               │
│  Jobs:                                                         │
│    1. Build & Test                                             │
│    2. Upload to S3 (frontend)                                  │
│    3. Deploy Backend (SSH)                                     │
│    4. Run Smoke Tests                                          │
│    5. Health Checks                                            │
│                                                                │
│  Result: Staging server updated automatically                 │
│  URL: https://staging.vayrex.com                             │
└─────────────────────────────────────────────────────────────────┘
           ↓
    Verify staging environment
    ./scripts/health-check.sh staging
           ↓
    Create Release PR: develop → main
           ↓
    Reviewers approve release
           ↓
┌─────────────────────────────────────────────────────────────────┐
│      GITHUB ACTIONS: DEPLOY TO PRODUCTION (Manual Approval)     │
├─────────────────────────────────────────────────────────────────┤
│  Trigger: Push to main branch (requires approval)             │
│  Jobs:                                                         │
│    1. Build & Test                                             │
│    2. Security Scan (npm audit + Trufflehog)                  │
│    3. Deploy Frontend (S3 + CloudFront invalidation)          │
│    4. Deploy Backend (SSH)                                     │
│    5. Verify Production                                        │
│    6. Create Deployment Record                                │
│                                                                │
│  Result: Production server updated                            │
│  URL: https://vayrex.com                                      │
└─────────────────────────────────────────────────────────────────┘
           ↓
    Monitor production
    ./scripts/health-check.sh production
           ↓
    Track in deployment record
```

## Environment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GITHUB REPOSITORY                            │
├─────────────────────────────────────────────────────────────────┤
│  main (Production Ready)                                        │
│  ├─ Branch Protection: 2 reviewers required                    │
│  ├─ Status Checks: Lint + Build + Security                    │
│  ├─ Signed Commits: Optional                                   │
│  └─ Tag: v1.0.0, v1.0.1 (auto-deployed)                       │
│                                                                │
│  develop (Staging Ready)                                       │
│  ├─ Branch Protection: 1 reviewer required                     │
│  ├─ Status Checks: Lint + Build                               │
│  └─ Auto-deploys to staging                                    │
│                                                                │
│  feature/* (Feature Branches)                                  │
│  ├─ Run full CI/CD checks on PR                               │
│  └─ Merge to develop after approval                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓↓↓
┌──────────────────────────────────────────────────────────────┐
│              STAGING ENVIRONMENT (develop)                   │
├──────────────────────────────────────────────────────────────┤
│  Frontend:                                                   │
│    • S3 Bucket: vayrex-staging                              │
│    • CDN: CloudFront (optional)                              │
│    • URL: https://staging.vayrex.com                        │
│    • Build: Next.js/Vite                                     │
│                                                              │
│  Backend:                                                    │
│    • Server: staging-server.vayrex.com:5000                │
│    • Database: MongoDB (staging cluster)                    │
│    • Cache: Redis (staging)                                │
│    • Health: /api/health endpoint                          │
│                                                              │
│  Storage:                                                    │
│    • S3: File uploads                                       │
│    • Backups: Weekly automated                              │
│                                                              │
│  Monitoring:                                                │
│    • Logs: /var/log/vayrex/                                │
│    • Health Check: ./scripts/health-check.sh staging       │
│    • Alerts: Slack (optional)                               │
└──────────────────────────────────────────────────────────────┘
            ↓↓↓
┌──────────────────────────────────────────────────────────────┐
│             PRODUCTION ENVIRONMENT (main)                    │
├──────────────────────────────────────────────────────────────┤
│  Frontend:                                                   │
│    • S3 Bucket: vayrex-production                           │
│    • CDN: CloudFront (cached)                               │
│    • URL: https://vayrex.com                               │
│    • Build: Optimized production build                      │
│                                                              │
│  Backend:                                                    │
│    • Servers: prod-server-1,2,3 (load balanced)           │
│    • Database: MongoDB (production cluster, replicas)      │
│    • Cache: Redis (production, sentinel)                   │
│    • Health: /api/health endpoint                          │
│                                                              │
│  Storage:                                                    │
│    • S3: File uploads (versioned)                           │
│    • Backups: Daily automated + manual before deploys      │
│    • Disaster Recovery: Multi-region                       │
│                                                              │
│  Monitoring:                                                │
│    • Logs: CloudWatch / ELK                                │
│    • Metrics: DataDog / New Relic                          │
│    • Alerts: Slack + PagerDuty                             │
│    • Health Check: ./scripts/health-check.sh production    │
│    • Uptime: 99.9% SLA                                      │
└──────────────────────────────────────────────────────────────┘
```

## Container Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    DOCKER COMPOSE SERVICES                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend (Nginx)                                               │
│  ┌────────────────────┐                                        │
│  │ nginx:alpine       │                                        │
│  │ Port: 80/443       │                                        │
│  │ ├─ React SPA       │                                        │
│  │ ├─ Static assets   │                                        │
│  │ ├─ Health: /health │                                        │
│  │ └─ Proxy: /api/... │ ───┐                                   │
│  └────────────────────┘    │                                   │
│                            │                                   │
│  Backend (Node.js)         │                                   │
│  ┌────────────────────┐    │                                   │
│  │ node:18-alpine     │ ◄──┘                                   │
│  │ Port: 5000         │                                        │
│  │ ├─ Express API     │                                        │
│  │ ├─ Health: /health │                                        │
│  │ ├─ Auth routes     │                                        │
│  │ └─ API routes      │                                        │
│  └────────────────────┘                                        │
│         │                                                      │
│         ├─→ ┌────────────────────┐                            │
│         │   │ mongo:6            │                            │
│         │   │ Port: 27017        │                            │
│         │   │ ├─ Database        │                            │
│         │   │ ├─ Collections      │                            │
│         │   │ └─ Backups         │                            │
│         │   └────────────────────┘                            │
│         │                                                      │
│         └─→ ┌────────────────────┐                            │
│             │ redis:7-alpine     │                            │
│             │ Port: 6379         │                            │
│             │ ├─ Cache           │                            │
│             │ ├─ Sessions        │                            │
│             │ └─ Rate limiting   │                            │
│             └────────────────────┘                            │
│                                                                │
└──────────────────────────────────────────────────────────────────┘
```

## CI/CD Job Parallelization

```
GitHub Push Event
        ↓
        ├─ [Job 1] lint-frontend ─────┐
        ├─ [Job 2] lint-backend ──────┤─ [Summary] All checks
        ├─ [Job 3] test-frontend ─────┤
        ├─ [Job 4] build-frontend ────┤
        ├─ [Job 5] build-backend ─────┤
        ├─ [Job 6] security-check ────┤
        └─ [Job 7] dependency-check ──┘
                        ↓
            All jobs complete (parallel)
                        ↓
                        ✓ Pass or ✗ Fail
                        ↓
            (If on develop) Deploy to Staging
            (If on main) Wait for Approval → Deploy to Production
```

## File Structure

```
vayrex/
├── .github/
│   └── workflows/
│       ├── lint-and-test.yml          ← Main CI workflow
│       ├── pull-request-checks.yml    ← PR validation
│       ├── deploy-staging.yml         ← Auto-deploy to staging
│       ├── deploy-production.yml      ← Manual production deploy
│       └── docker-build.yml          ← Container builds
│
├── scripts/
│   ├── deploy-backend.sh             ← Manual backend deploy
│   ├── deploy-frontend.sh            ← Manual frontend deploy
│   ├── health-check.sh               ← Service verification
│   └── rollback.sh                   ← Emergency rollback
│
├── backend/
│   ├── Dockerfile                    ← Backend container
│   ├── server.js
│   ├── package.json
│   └── ... (API code)
│
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   └── ... (React code)
│
├── Dockerfile.frontend               ← Frontend container
├── nginx.conf                        ← Nginx config
├── docker-compose.yml                ← Local development
├── docker-compose.production.yml     ← Production stack
│
├── .env.staging                      ← Staging config
├── .env.production                   ← Production config
│
├── CI_CD_GUIDE.md                    ← Detailed guide
├── SECRETS_SETUP.md                  ← Secret configuration
├── DEPLOYMENT_RULES.md               ← Branch rules
├── CICD_README.md                    ← Quick start
└── CICD_IMPLEMENTATION.md            ← This file
```

## Secrets Flow

```
GitHub Secrets (Encrypted)
    ↓
  AWS_ACCESS_KEY_ID ────┐
  AWS_SECRET_ACCESS_KEY ├─→ [Deploy to S3]
  S3_BUCKET ────────────┘
    ↓
  JWT_SECRET ───────────→ [Backend Env]
  MONGODB_URI ──────────→ [Backend Env]
    ↓
  SLACK_WEBHOOK_URL ────→ [Notifications]
    ↓
  DEPLOY_KEY ───────────→ [SSH Authentication]
```

## Status Checks Required

```
Before Merge to main:
  ✓ lint-frontend passed
  ✓ lint-backend passed
  ✓ build-frontend passed
  ✓ build-backend passed
  ✓ security-check passed
  ✓ 2 approvals from reviewers
  ✓ Branches up to date

Before Merge to develop:
  ✓ lint-frontend passed
  ✓ lint-backend passed
  ✓ build-frontend passed
  ✓ build-backend passed
  ✓ 1 approval from reviewer
  ✓ Branches up to date
```

---

**Visual Guide Complete**  

