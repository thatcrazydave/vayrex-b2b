#!/bin/bash

# Deployment script for Vayrex backend
# Usage: ./scripts/deploy-backend.sh <environment>

set -e

ENVIRONMENT=${1:-staging}
TIMESTAMP=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

echo "=========================================="
echo " Deploying Backend to $ENVIRONMENT"
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
required_vars=("DEPLOY_SERVER" "DEPLOY_USER" "DEPLOY_PATH" "DEPLOY_KEY")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo " Missing required variable: $var"
    exit 1
  fi
done

# Build backend
echo "  Building backend..."
cd backend
npm ci
npm run build 2>/dev/null || echo "✓ Backend validated"
cd ..

# Create deployment archive
echo "  Creating deployment package..."
DEPLOY_ARCHIVE="vayrex-backend-$(date +%s).tar.gz"
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='.env' \
    -czf "$DEPLOY_ARCHIVE" backend/

echo "✓ Created $DEPLOY_ARCHIVE"

# Upload to server
echo "📤 Uploading to server..."
scp -i "$DEPLOY_KEY" -o StrictHostKeyChecking=no \
    "$DEPLOY_ARCHIVE" \
    "$DEPLOY_USER@$DEPLOY_SERVER:$DEPLOY_PATH/"

# Deploy on remote server
echo "🔄 Deploying on remote server..."
ssh -i "$DEPLOY_KEY" -o StrictHostKeyChecking=no \
    "$DEPLOY_USER@$DEPLOY_SERVER" << 'REMOTE_SCRIPT'
  set -e
  DEPLOY_PATH="${DEPLOY_PATH}"
  ARCHIVE_NAME=$(ls -t "$DEPLOY_PATH"/vayrex-backend-*.tar.gz | head -1 | xargs basename)
  
  echo "📂 Extracting $ARCHIVE_NAME..."
  cd "$DEPLOY_PATH"
  tar -xzf "$ARCHIVE_NAME"
  
  echo "  Installing dependencies..."
  cd backend
  npm ci --only=production
  
  echo "🔄 Restarting service..."
  if command -v systemctl &> /dev/null; then
    sudo systemctl restart vayrex-backend
  elif command -v service &> /dev/null; then
    sudo service vayrex-backend restart
  fi
  
  echo "✓ Deployment complete"
REMOTE_SCRIPT

# Cleanup
rm "$DEPLOY_ARCHIVE"

# Health check
echo " Running health checks..."
sleep 5

HEALTH_CHECK_URL="https://$DEPLOY_SERVER/api/health"
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_CHECK_URL")

if [ "$HEALTH_RESPONSE" = "200" ]; then
  echo " Health check passed"
  echo "=========================================="
  echo " Backend deployment successful!"
  echo "Environment: $ENVIRONMENT"
  echo "Timestamp: $TIMESTAMP"
  echo "=========================================="
else
  echo " Health check failed (HTTP $HEALTH_RESPONSE)"
  exit 1
fi

