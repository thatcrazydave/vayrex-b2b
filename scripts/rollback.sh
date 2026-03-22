#!/bin/bash

# Rollback script for emergency rollbacks
# Usage: ./scripts/rollback.sh <environment> <version>

ENVIRONMENT=${1:-staging}
VERSION=${2:-previous}
TIMESTAMP=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

echo "=========================================="
echo "  Rolling back $ENVIRONMENT to $VERSION"
echo "Timestamp: $TIMESTAMP"
echo "=========================================="

# Load environment
if [ -f ".env.$ENVIRONMENT" ]; then
  source ".env.$ENVIRONMENT"
else
  echo " .env.$ENVIRONMENT not found"
  exit 1
fi

# Confirm action
read -p "Are you sure you want to rollback? (yes/no) " -n 3 -r
echo
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  echo " Rollback cancelled"
  exit 1
fi

# Get available versions
echo "  Available versions:"
aws s3 ls "s3://$S3_BUCKET/backups/" || echo "No backups found"

if [ "$VERSION" = "previous" ]; then
  # Get the second-latest version
  VERSION=$(aws s3 ls "s3://$S3_BUCKET/backups/" | tail -2 | head -1 | awk '{print $4}' | sed 's/.tar.gz//')
fi

if [ -z "$VERSION" ]; then
  echo " Version not specified and no previous version found"
  exit 1
fi

echo "🔄 Rolling back to: $VERSION"

# Download backup
BACKUP_FILE="$VERSION.tar.gz"
echo " Downloading backup..."
aws s3 cp "s3://$S3_BUCKET/backups/$BACKUP_FILE" .

# Extract and deploy
echo "📂 Extracting backup..."
tar -xzf "$BACKUP_FILE"

echo " Deploying rolled-back version..."
# Deploy logic here

rm "$BACKUP_FILE"

echo "=========================================="
echo " Rollback complete!"
echo "Environment: $ENVIRONMENT"
echo "Version: $VERSION"
echo "Timestamp: $TIMESTAMP"
echo "=========================================="

