#!/bin/bash

# Health check script for Vayrex services
# Usage: ./scripts/health-check.sh <environment>

ENVIRONMENT=${1:-staging}
CHECK_INTERVAL=${2:-30}
MAX_ATTEMPTS=${3:-5}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load environment
if [ -f ".env.$ENVIRONMENT" ]; then
  source ".env.$ENVIRONMENT"
else
  echo " .env.$ENVIRONMENT not found"
  exit 1
fi

API_HEALTH_URL="${API_URL}/health"
FRONTEND_URL="${FRONTEND_URL:-http://localhost}"

check_api() {
  echo -n "Checking API health... "
  
  for attempt in $(seq 1 $MAX_ATTEMPTS); do
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_HEALTH_URL")
    
    if [ "$RESPONSE" = "200" ]; then
      echo -e "${GREEN}✓${NC}"
      return 0
    fi
    
    if [ $attempt -lt $MAX_ATTEMPTS ]; then
      echo -n "."
      sleep $CHECK_INTERVAL
    fi
  done
  
  echo -e "${RED}✗ (HTTP $RESPONSE)${NC}"
  return 1
}

check_database() {
  echo -n "Checking database connectivity... "
  
  API_DB_CHECK="${API_URL}/health/db"
  RESPONSE=$(curl -s "$API_DB_CHECK" | grep -c "connected" || true)
  
  if [ "$RESPONSE" -gt 0 ]; then
    echo -e "${GREEN}✓${NC}"
    return 0
  else
    echo -e "${RED}✗${NC}"
    return 1
  fi
}

check_redis() {
  echo -n "Checking Redis connectivity... "
  
  API_REDIS_CHECK="${API_URL}/health/redis"
  RESPONSE=$(curl -s "$API_REDIS_CHECK" | grep -c "connected" || true)
  
  if [ "$RESPONSE" -gt 0 ]; then
    echo -e "${GREEN}✓${NC}"
    return 0
  else
    echo -e "${RED}✗${NC}"
    return 1
  fi
}

check_frontend() {
  echo -n "Checking frontend health... "
  
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
  
  if [ "$RESPONSE" = "200" ]; then
    echo -e "${GREEN}✓${NC}"
    return 0
  else
    echo -e "${RED}✗ (HTTP $RESPONSE)${NC}"
    return 1
  fi
}

check_s3_access() {
  echo -n "Checking S3 access... "
  
  if aws s3 ls "s3://$S3_BUCKET" --region "$AWS_REGION" &>/dev/null; then
    echo -e "${GREEN}✓${NC}"
    return 0
  else
    echo -e "${RED}✗${NC}"
    return 1
  fi
}

echo "=========================================="
echo " Health Check - $ENVIRONMENT"
echo "Timestamp: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "=========================================="
echo ""

FAILED=0

check_api || FAILED=$((FAILED + 1))
check_database || FAILED=$((FAILED + 1))
check_redis || FAILED=$((FAILED + 1))
check_frontend || FAILED=$((FAILED + 1))
check_s3_access || FAILED=$((FAILED + 1))

echo ""
echo "=========================================="
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN} All checks passed${NC}"
  exit 0
else
  echo -e "${RED} $FAILED check(s) failed${NC}"
  exit 1
fi
echo "=========================================="

