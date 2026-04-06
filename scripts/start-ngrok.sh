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

echo "  Starting HTTPS tunnel for localhost:5002 (B2B backend)"
echo ""
echo " Once started:"
echo "   1. Copy the HTTPS URL (https://abc123.ngrok-free.app)"
echo "   2. Set it as VITE_API_URL in Netlify dashboard (append /api)"
echo "   3. Add it to backend/.env CORS_ORIGINS"
echo "   4. Restart backend server"
echo "   5. Trigger a Netlify redeploy so the frontend picks up the new URL"
echo ""

# Start ngrok with HTTPS scheme only — tunnels B2B backend on port 5002
ngrok http 5002 --scheme https
