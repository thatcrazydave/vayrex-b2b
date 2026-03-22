# GitHub Actions Secrets Configuration

## How to Add Secrets

1. Go to your GitHub repository
2. Navigate to: **Settings → Secrets and variables → Actions**
3. Click **"New repository secret"**
4. Enter the secret name and value
5. Click **"Add secret"**

## Required Secrets

### AWS Credentials
```
Name: AWS_ACCESS_KEY_ID
Value: Your AWS access key ID

Name: AWS_SECRET_ACCESS_KEY
Value: Your AWS secret access key

Name: AWS_REGION
Value: us-east-1 (or your region)
```

### Staging Environment
```
Name: STAGING_S3_BUCKET
Value: vayrex-staging

Name: STAGING_SERVER_URL
Value: https://staging.vayrex.com

Name: STAGING_DEPLOY_KEY
Value: <SSH private key for staging server>
```

### Production Environment
```
Name: PROD_AWS_ACCESS_KEY_ID
Value: Your production AWS access key

Name: PROD_AWS_SECRET_ACCESS_KEY
Value: Your production AWS secret key

Name: PROD_AWS_REGION
Value: us-east-1 (or your region)

Name: PROD_S3_BUCKET
Value: vayrex-production

Name: PROD_CLOUDFRONT_ID
Value: E1234567890ABC (CloudFront distribution ID)

Name: PROD_SERVER_URL
Value: https://api.vayrex.com

Name: PROD_DEPLOY_KEY
Value: <SSH private key for production server>

Name: PROD_MONGODB_URI
Value: mongodb+srv://user:password@cluster.mongodb.net/vayrex

Name: PROD_JWT_SECRET
Value: <Long random string for JWT signing>
```

### OpenAI API
```
Name: OPENAI_API_KEY
Value: sk-... (Your OpenAI API key)
```

## Creating SSH Keys for Deployment

```bash
# Generate SSH key pair
ssh-keygen -t rsa -b 4096 -f vayrex_deploy -C "vayrex-ci"

# This creates:
# - vayrex_deploy (private key - add as secret)
# - vayrex_deploy.pub (public key - add to server)

# Add public key to server:
cat vayrex_deploy.pub >> ~/.ssh/authorized_keys

# Keep private key secure and add to GitHub Secrets
```

## Environment Variables for Workflows

Variables used in workflows are already referenced. These secrets will be automatically available:

```yaml
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

## Testing Secrets

To verify secrets are working:

1. Run a test workflow
2. Check the "Logs" section
3. Secrets should not be printed in output (masked with ***)

## Security Best Practices

 **Do**:
- Use unique secrets for each environment
- Rotate secrets regularly
- Use long, random strings for API keys
- Limit secret access to necessary workflows
- Monitor secret usage

 **Don't**:
- Commit secrets to repository
- Share secrets in chat or email
- Reuse production secrets in staging
- Log or print secrets
- Use simple/guessable secrets

## Troubleshooting

### Secret Not Found in Workflow
```
Error: Unexpected input 'secret-name'
```
- Check spelling matches exactly
- Secrets are case-sensitive
- Verify secret exists in Settings

### Secrets Not Being Injected
- Clear GitHub Actions cache: Settings → Actions → Clear all caches
- Re-run the workflow
- Verify secret names in workflow YAML

### Access Denied with AWS
- Verify IAM user has S3 permissions
- Check AWS region matches
- Verify bucket exists in that region

