# CI/CD Configuration Guide

## Overview

This project uses GitHub Actions for continuous integration and deployment. The CI/CD pipeline automates testing, building, and deployment processes.

## Workflows

### 1. **Lint & Test** (`lint-and-test.yml`)
**Trigger**: On push to `main` or `develop`, or on pull requests
**Purpose**: Code quality checks and initial validation

**Jobs**:
-  `lint-frontend` - ESLint checks on React code
-  `lint-backend` - Node.js syntax validation
-  `test-frontend` - Run frontend tests (if available)
-  `build-frontend` - Build React app with Vite
-  `build-backend` - Validate backend dependencies
-  `security-check` - npm audit for vulnerabilities
-  `dependency-check` - Check for outdated packages
-  `summary` - Final status report

### 2. **Pull Request Checks** (`pull-request-checks.yml`)
**Trigger**: On pull request to `main` or `develop`
**Purpose**: Enhanced checks before merge

**Jobs**:
- 🔍 Code quality analysis
-  Changes detection (API, DB, Security)
- 🏗️ Build validation
-   Dependency update detection
- 💬 Automatic PR comments

### 3. **Deploy to Staging** (`deploy-staging.yml`)
**Trigger**: Push to `develop` branch
**Purpose**: Automated staging deployment

**Jobs**:
-  Test & Build
-  Upload frontend to staging
-  Deploy backend to staging
-  Run smoke tests
- 📢 Deployment notifications

### 4. **Deploy to Production** (`deploy-production.yml`)
**Trigger**: Push to `main` branch (requires approval)
**Purpose**: Production deployment with security scans

**Jobs**:
-  Test & Build
-   Security scanning
-  Deploy to production
-  Verification
-   Deployment records

### 5. **Docker Build & Push** (`docker-build.yml`)
**Trigger**: On tag creation or push to `main`/`develop`
**Purpose**: Build and push Docker images

**Jobs**:
- 🐳 Backend Docker image
- 🐳 Frontend Docker image
-   Push to container registry (GHCR)

## Required Secrets

Add these secrets in GitHub repository settings:

### Staging Secrets
```
STAGING_S3_BUCKET         - S3 bucket for staging
STAGING_SERVER_URL        - Staging server URL
STAGING_DEPLOY_KEY        - SSH key for staging deployment
```

### Production Secrets
```
PROD_AWS_ACCESS_KEY_ID        - AWS access key
PROD_AWS_SECRET_ACCESS_KEY    - AWS secret key
PROD_AWS_REGION               - AWS region
PROD_S3_BUCKET                - S3 bucket for production
PROD_CLOUDFRONT_ID            - CloudFront distribution ID
PROD_SERVER_URL               - Production server URL
PROD_DEPLOY_KEY               - SSH key for production deployment
PROD_MONGODB_URI              - MongoDB connection string
PROD_JWT_SECRET               - JWT signing secret
```

## GitHub Environments

Configure these environments for gated deployments:

### Development
- Auto-deploys from `develop` branch
- No approval required

### Staging
- Manual trigger option
- Security checks required
- Smoke tests before approval

### Production
- Requires explicit approval
- Runs security scans
- Restricted to `main` branch only

## Local Development

### Build Docker images locally:
```bash
# Backend
docker build -f backend/Dockerfile -t vayrex-backend:latest ./backend

# Frontend
docker build -f Dockerfile.frontend -t vayrex-frontend:latest .
```

### Run with Docker Compose:
```bash
# Development (existing)
docker-compose up

# Production-like
docker-compose -f docker-compose.production.yml up
```

## Branch Strategy

```
main (production)
  └─ Create release tags (v1.0.0, v1.0.1, etc.)
  └─ Protected: requires PR review + CI passing
  └─ Auto-deploys to production

develop (staging)
  └─ Feature branches merge here
  └─ Auto-deploys to staging
  └─ Base for feature/bugfix branches

feature/* (feature branches)
  └─ Branch from: develop
  └─ PR back to: develop
  └─ Runs: Full CI/CD checks
```

## Making Changes

### 1. Create Feature Branch
```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-feature
```

### 2. Commit Changes
```bash
git add .
git commit -m "feat: add new feature"
```

### 3. Push & Create PR
```bash
git push origin feature/my-feature
# Create PR on GitHub
```

### 4. CI/CD Runs Automatically
-  Linting checks
-  Build validation
-  Security scan
-  Comment on PR with status

### 5. Merge PR
- Once all checks pass
- Merge into `develop`
- Auto-deploys to staging

### 6. Release to Production
```bash
# Create release PR from develop to main
# Get approval
# Merge PR
# Tag the release (v1.0.0)
# Auto-deploys to production
```

## Monitoring Deployments

### GitHub Actions Dashboard
Visit: `Settings → Actions` to see workflow runs

### Workflow Status Badge
Add to README.md:
```markdown
![CI/CD Status](https://github.com/YOUR_ORG/tester/actions/workflows/lint-and-test.yml/badge.svg)
```

## Troubleshooting

### Workflow Failed
1. Click on the failed workflow
2. Check the job logs
3. Fix the issue locally
4. Push changes - workflow re-runs automatically

### Docker Build Failed
- Ensure Dockerfile syntax is correct
- Check dependencies in package.json
- Verify base image is available

### Deployment Failed
- Check secrets are configured correctly
- Verify server connectivity
- Check deployment logs for errors

## Best Practices

 **Do**:
- Keep builds fast (<5 minutes)
- Test locally before pushing
- Use meaningful commit messages
- Create tags for releases
- Monitor workflow runs

 **Don't**:
- Force push to main or develop
- Skip PR reviews
- Commit secrets or .env files
- Merge failing builds
- Ignore security warnings

## Performance Tips

1. **Use caching**: Workflows already cache npm dependencies
2. **Parallel jobs**: Jobs run in parallel for speed
3. **Selective triggers**: Workflows only run when needed
4. **Artifact cleanup**: Old artifacts auto-delete after 5 days

## Next Steps

1. Add repository secrets in GitHub Settings
2. Create GitHub Environments (Staging, Production)
3. Set branch protection rules
4. Configure notifications for deployment failures
5. Set up monitoring on deployed services

