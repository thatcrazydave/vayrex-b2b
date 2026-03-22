#!/bin/bash

# Deployment script for Vayrex frontend
# Usage: ./scripts/deploy-frontend.sh <environment>

set -e

ENVIRONMENT=${1:-staging}
TIMESTAMP=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

echo "=========================================="
echo " Deploying Frontend to $ENVIRONMENT"
echo "Timestamp: $TIMESTAMP"
echo "=========================================="

# Load environment variables
if [ -f ".env.$ENVIRONMENT" ]; then
  source ".env.$ENVIRONMENT"
  echo "✓ Loaded .env.$ENVIRONMENT"
else
  echo " .env.$ENVIRONMENT not found"
  exit 1
fi

# Validate required variables
required_vars=("AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "S3_BUCKET")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo " Missing required variable: $var"
    exit 1
  fi
done

# Build frontend
echo "🔨 Building frontend..."
npm ci
VITE_API_URL="$API_URL" npm run build

if [ ! -d "dist" ]; then
  echo " Build failed - dist directory not found"
  exit 1
fi

echo "✓ Build complete"

# Upload to S3
echo "📤 Uploading to S3..."
aws s3 sync dist/ "s3://$S3_BUCKET/" \
  --delete \
  --cache-control "public, max-age=86400" \
  --exclude ".gitkeep"

# Invalidate CloudFront cache (if configured)
if [ ! -z "$CLOUDFRONT_ID" ]; then
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_ID" \
    --paths "/*"
  echo "✓ CloudFront invalidation requested"
fi

echo "=========================================="
echo " Frontend deployment successful!"
echo "Environment: $ENVIRONMENT"
echo "Bucket: $S3_BUCKET"
echo "Timestamp: $TIMESTAMP"
echo "=========================================="

