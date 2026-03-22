# Branch Protection & Deployment Rules

## GitHub Branch Protection

### Protect the `main` branch:

1. Go to **Settings → Branches**
2. Click **"Add rule"** under "Branch protection rules"
3. Enter branch name pattern: `main`
4. Configure:

#### Require pull request reviews before merging
-  Require pull request reviews before merging
-  Dismiss stale pull request approvals when new commits are pushed
-  Require review from code owners
- Number of required reviewers: **2**

#### Require status checks to pass before merging
-  Require status checks to pass before merging
-  Require branches to be up to date before merging

Select status checks:
- `lint-frontend`
- `lint-backend`
- `build-frontend`
- `build-backend`
- `security-check`

#### Additional protections
-  Include administrators
-  Restrict who can push to matching branches
  - Allowed users: `@vayrex-admins`
  - Allowed teams: `DevOps`

### Protect the `develop` branch:

1. Go to **Settings → Branches**
2. Click **"Add rule"**
3. Enter branch name pattern: `develop`
4. Configure:

#### Require pull request reviews before merging
-  Require pull request reviews before merging
-  Dismiss stale pull request approvals
- Number of required reviewers: **1**

#### Require status checks to pass before merging
-  Require status checks to pass before merging
-  Require branches to be up to date before merging

Select status checks:
- `lint-frontend`
- `lint-backend`
- `build-frontend`
- `build-backend`

## Deployment Protection Rules

### Staging Environment

**Settings → Environments → Create environment: `staging`**

Configuration:
- Deployment branches and tags: `develop`
- Required reviewers: None (auto-deploy)
- Deployment protection rules: 
  -  Wait timer: 0 minutes

### Production Environment

**Settings → Environments → Create environment: `production`**

Configuration:
- Deployment branches and tags: `main`, `refs/tags/v*`
- Required reviewers: **2** people
- Required reviewers: Select `@vayrex-devops` team
- Deployment protection rules:
  -  Wait timer: 5 minutes (cool-down after approval)

## Code Owners

Create `.github/CODEOWNERS` file:

```
# Global owners
* @lead-developer @tech-lead

# Backend changes
/backend/ @backend-team
/backend/routes/ @lead-developer
/backend/security/ @security-team

# Frontend changes
/src/ @frontend-team
/src/components/admin/ @lead-developer

# Infrastructure
/.github/ @devops-team
/docker* @devops-team

# Config and security
.env* @security-team
```

## Commit Signing

### Setup GPG key signing:

```bash
# Generate GPG key
gpg --full-generate-key

# List keys
gpg --list-secret-keys

# Configure Git
git config --global user.signingkey <KEY_ID>
git config --global commit.gpgsign true

# Sign commits
git commit -S -m "feat: new feature"
```

## Require signed commits

**Settings → Branches → Branch protection rules**

For `main` branch:
-  Require signed commits

## Pull Request Template

Create `.github/pull_request_template.md`:

```markdown
## Description
Brief description of the changes

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Closes #123

## Changes Made
- Item 1
- Item 2

## Testing
- [ ] Unit tests added
- [ ] Integration tests passed
- [ ] Manual testing completed

## Checklist
- [ ] My code follows the style guidelines
- [ ] I have performed a self-review
- [ ] I have commented complex code
- [ ] I have updated documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix works

## Screenshots (if applicable)
Add screenshots for UI changes
```

## Issue Templates

Create `.github/ISSUE_TEMPLATE/bug_report.md`:

```markdown
---
name: Bug Report
about: Create a report to help us improve
title: "[BUG] "
labels: 'bug'
assignees: ''

---

## Describe the bug
A clear description of what the bug is.

## To Reproduce
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

## Expected behavior
What should happen

## Actual behavior
What actually happens

## Environment
- OS: [e.g., macOS, Windows]
- Browser: [e.g., Chrome, Safari]
- Version: [e.g., 22]

## Additional context
Add any other context about the problem here.
```

Create `.github/ISSUE_TEMPLATE/feature_request.md`:

```markdown
---
name: Feature Request
about: Suggest an idea
title: "[FEATURE] "
labels: 'enhancement'
assignees: ''

---

## Description
Clear description of the proposed feature

## Problem it solves
What problem does this feature solve?

## Proposed solution
How should this feature work?

## Alternatives considered
Other approaches considered

## Additional context
Any other information
```

## Auto-merge Configuration

**Settings → Pull requests → Enable auto-merge**

-  Allow auto-merge: enabled
- When PR is approved and all checks pass, auto-merge will be available

## Notification Rules

**Settings → Notifications → Custom routing**

Create rules:
- Pushes to `main` → Notify security team
- Failed deployments → Notify DevOps
- Review requests → Notify reviewer

## Workflow Dispatch Permissions

Allow manual workflow triggers:
- `deploy-production.yml` - Only admins
- `deploy-staging.yml` - All developers
- `docker-build.yml` - All developers

