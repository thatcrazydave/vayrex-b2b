#!/bin/bash

# Simple script to start ngrok with HTTPS for backend
# Just run: ./scripts/start-ngrok.sh

echo "🚀 Starting ngrok HTTPS tunnel for backend..."
echo "=============================================="
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "  Error: ngrok is not installed"
    echo "   Install: brew install ngrok"
    exit 1
fi

echo "  Starting HTTPS tunnel for localhost:5001"
echo ""
echo " Once started:"
echo "   1. Copy the HTTPS URL (https://abc123.ngrok-free.app)"
echo "   2. Add it to backend/.env CORS_ORIGINS"
echo "   3. Restart backend server"
echo "   4. Use the HTTPS URL on mobile - CSRF will work!"
echo ""

# Start ngrok with HTTPS scheme only
ngrok http 5001 --scheme https
