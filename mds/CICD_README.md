# Vayrex CI/CD & Deployment

##  Quick Start

### 1. Initial Setup (One-time)

```bash
# Clone the repository
git clone https://github.com/your-org/vayrex.git
cd vayrex

# Install dependencies
npm install
cd backend && npm install && cd ..

# Create environment files
cp .env.staging.example .env.staging
cp .env.production.example .env.production
# Edit with your configuration
```

### 2. Configure GitHub Secrets

Visit: **Settings → Secrets and variables → Actions**

Add required secrets (see [SECRETS_SETUP.md](SECRETS_SETUP.md))

### 3. Setup Branch Protection

Visit: **Settings → Branches**

Configure rules (see [DEPLOYMENT_RULES.md](DEPLOYMENT_RULES.md))

##   Workflows

### Automatic Workflows

| Trigger | Workflow | Purpose |
|---------|----------|---------|
| Push to `develop` | Deploy to Staging | Auto-deploy to staging environment |
| Push to `main` | Deploy to Production | Requires approval, deploys to production |
| Pull Request | PR Checks | Linting, building, security scans |
| Push (any) | Lint & Test | Code quality checks |
| Tag push | Docker Build | Build and push Docker images |

### Manual Workflows

**GitHub Actions → Select Workflow → Run workflow**

- Deploy to Staging
- Deploy to Production (requires approval)
- Docker Build & Push

## 🔄 Deployment Flow

### From Feature to Production

```
1. Create feature branch from develop
   $ git checkout -b feature/my-feature develop

2. Make changes and commit
   $ git add .
   $ git commit -m "feat: add new feature"

3. Push and create PR
   $ git push origin feature/my-feature
   # Create PR on GitHub

4. CI/CD runs automatically
   ✓ Linting
   ✓ Build
   ✓ Security scan
   ✓ PR checks

5. Get review approval
   # Reviewers check and approve

6. Merge to develop
   # Automatically deploys to STAGING

7. Verify staging environment
   $ ./scripts/health-check.sh staging
   # Test new features on staging

8. Create release PR to main
   $ git checkout main && git pull
   $ git checkout -b release/v1.0.0 develop
   $ npm version minor
   $ git push origin release/v1.0.0
   # Create PR to main

9. Production deployment requires approval
   # Lead reviewer approves
   # Merges to main
   # Automatically deploys to PRODUCTION

10. Verify production
    $ ./scripts/health-check.sh production
```

##   Deployment Scripts

### Health Check
```bash
# Check staging environment
./scripts/health-check.sh staging

# Check production
./scripts/health-check.sh production

# Output:
# ✓ API health
# ✓ Database connectivity
# ✓ Redis connectivity
# ✓ Frontend health
# ✓ S3 access
```

### Deploy Frontend
```bash
# Deploy to staging (uses npm run build + S3 sync)
./scripts/deploy-frontend.sh staging

# Deploy to production
./scripts/deploy-frontend.sh production
```

### Deploy Backend
```bash
# Deploy to staging
./scripts/deploy-backend.sh staging

# Deploy to production
./scripts/deploy-backend.sh production
```

### Rollback
```bash
# Rollback to previous version
./scripts/rollback.sh production previous

# Rollback to specific version
./scripts/rollback.sh production v1.0.0
```

## 🐳 Docker Deployment

### Build Docker Images

```bash
# Build backend
docker build -f backend/Dockerfile -t vayrex-backend:latest ./backend

# Build frontend
docker build -f Dockerfile.frontend -t vayrex-frontend:latest .

# Build using compose
docker-compose build

# Production compose
docker-compose -f docker-compose.production.yml build
```

### Run Containers

```bash
# Development
docker-compose up

# Production
docker-compose -f docker-compose.production.yml up -d

# Production with specific services
docker-compose -f docker-compose.production.yml up -d backend mongo redis
```

### Push to Container Registry

```bash
# Login to GitHub Container Registry
docker login ghcr.io

# Tag images
docker tag vayrex-backend:latest ghcr.io/your-org/vayrex-backend:latest
docker tag vayrex-frontend:latest ghcr.io/your-org/vayrex-frontend:latest

# Push
docker push ghcr.io/your-org/vayrex-backend:latest
docker push ghcr.io/your-org/vayrex-frontend:latest
```

##   Monitoring Deployments

### GitHub Actions Dashboard
- Visit: https://github.com/your-org/vayrex/actions
- View all workflow runs
- Check logs for failed workflows

### View Logs
```bash
# Install GitHub CLI
brew install gh

# View workflow runs
gh run list

# View specific run details
gh run view <RUN_ID> --log
```

## 🔍 Troubleshooting

### Workflow Failed

1. Click on failed workflow in GitHub Actions
2. Expand the failed job
3. Review the error message
4. Fix locally and re-push

Common issues:
- Missing secrets → Add to GitHub Settings
- Failed linting → Run `npm run lint` locally
- Build failed → Check `npm run build` locally

### Deployment Failed

1. Check SSH/AWS credentials
2. Verify server connectivity: `ssh -i key user@host`
3. Check server disk space: `df -h`
4. Review server logs: `tail -f /var/log/vayrex/app.log`

### Docker Build Failed

1. Verify Dockerfile syntax
2. Check base images are available: `docker pull node:18-alpine`
3. Build locally to debug: `docker build -t test .`

## 🛡️ Security

### Branch Protection
-  Main branch requires 2 reviews
-  Develop branch requires 1 review
-  Status checks must pass
-  Signed commits required (optional)

### Secrets Management
- Store all credentials in GitHub Secrets
- Never commit `.env` files
- Rotate secrets periodically
- Use environment-specific secrets

### Code Scanning
- ESLint checks all PRs
- npm audit detects vulnerabilities
- Trufflehog scans for secrets
- Security headers configured in nginx

##  Performance

### Build Times
- Lint & Test: ~2 minutes
- Frontend build: ~1 minute
- Backend validation: ~30 seconds
- Docker build: ~2 minutes

### Optimizations
- GitHub Actions cache reduces npm install time
- Docker layer caching speeds up rebuilds
- Parallel jobs run independently
- Artifacts auto-delete after 5 days

##  Best Practices

 **Do**:
- Create feature branches for all changes
- Write meaningful commit messages
- Test locally before pushing
- Keep branches updated with main/develop
- Tag releases (v1.0.0, v1.0.1)
- Review PR changes carefully

 **Don't**:
- Force push to main or develop
- Skip PR reviews
- Commit secrets or credentials
- Disable branch protection
- Skip automated checks
- Merge without green CI status

##   Additional Resources

- [CI/CD Guide](CI_CD_GUIDE.md) - Detailed workflow documentation
- [Secrets Setup](SECRETS_SETUP.md) - Configure GitHub Secrets
- [Deployment Rules](DEPLOYMENT_RULES.md) - Branch protection & environments
- [GitHub Actions Docs](https://docs.github.com/actions)
- [Docker Docs](https://docs.docker.com/)

## 🆘 Getting Help

### Check Logs
```bash
# View GitHub Actions logs
# Settings → Actions → Select workflow → View run

# View deployment logs (requires SSH access)
ssh user@server tail -f /var/log/vayrex/deployment.log
```

### Common Commands
```bash
# Test locally
npm run lint
npm run build

# Run backend locally
cd backend && npm run dev

# Run frontend locally
npm run dev

# Check Docker
docker ps
docker logs container-name
```

##  Changelog

### v1.0.0 (2026-01-11)
-   Initial CI/CD setup
- 🐳 Docker containerization
-  GitHub Actions workflows
- 📜 Deployment scripts
-   Security configuration

---

**Last Updated**: 2026-01-11
**Status**: Production Ready  

