#!/bin/bash

#  Netlify Deployment Script
# This prepares and deploys your frontend to Netlify

echo " Preparing Vayrex Frontend for Netlify..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Build the frontend
echo -e "${BLUE}  Building frontend...${NC}"
npm run build

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}  Build failed! Fix errors and try again.${NC}"
    exit 1
fi

echo -e "${GREEN}  Build completed successfully!${NC}"
echo ""

# Step 2: Check if Netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo -e "${YELLOW} Netlify CLI not found. Installing...${NC}"
    npm install -g netlify-cli
fi

# Step 3: Display deployment options
echo -e "${BLUE} Ready to deploy!${NC}"
echo ""
echo "Choose deployment option:"
echo "  1) Deploy to Netlify (production)"
echo "  2) Preview deployment (draft)"
echo "  3) Open Netlify dashboard"
echo "  4) Exit"
echo ""
read -p "Enter your choice (1-4): " choice

case $choice in
    1)
        echo -e "${BLUE} Deploying to production...${NC}"
        netlify deploy --prod
        ;;
    2)
        echo -e "${BLUE}🔍 Creating preview deployment...${NC}"
        netlify deploy
        ;;
    3)
        echo -e "${BLUE}🌐 Opening Netlify dashboard...${NC}"
        netlify open
        ;;
    4)
        echo -e "${GREEN}👋 Deployment cancelled.${NC}"
        exit 0
        ;;
    *)
        echo -e "${YELLOW}  Invalid choice!${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}  Done!${NC}"
echo ""
echo -e "${YELLOW} Important reminders:${NC}"
echo "  1. Your backend must be running on: http://192.168.0.199:5001"
echo "  2. Keep your laptop on the same WiFi network"
echo "  3. Set environment variables in Netlify Dashboard if this is first deployment"
echo ""
echo -e "${BLUE}  After deployment:${NC}"
echo "  • Visit your site URL"
echo "  • Start backend: cd backend && npm start"
echo "  • Check CORS is working"
