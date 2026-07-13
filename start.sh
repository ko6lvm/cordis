#!/bin/bash

# Navigate to the directory of this script
cd "$(dirname "$0")"

# 1. Load environment variables from .env if it exists
if [ -f .env ]; then
    echo "Loading environment variables from .env..."
    # Export variables ignoring comments
    export $(grep -v '^#' .env | xargs)
else
    echo "Warning: .env file not found. Running with default environment variables."
fi

# 2. Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo "Activating virtual environment (venv)..."
    source venv/bin/activate
elif [ -d ".venv" ]; then
    echo "Activating virtual environment (.venv)..."
    source .venv/bin/activate
fi

# 3. Check if server is already running on port 8000
PORT=8000
PID=$(lsof -t -i:$PORT 2>/dev/null)
if [ ! -z "$PID" ]; then
    echo "Error: Something is already running on port $PORT (PID: $PID). Please stop it first."
    exit 1
fi

# 4. Start the FastAPI server in the background using nohup
echo "Starting Cordis backend on port $PORT in the background..."
nohup uvicorn main:app --host 0.0.0.0 --port $PORT > app.log 2>&1 &

# Save the process ID (PID)
NEW_PID=$!
echo $NEW_PID > app.pid

echo "--------------------------------------------------------"
echo "Cordis has been started successfully!"
echo "PID: $NEW_PID"
echo "Port: $PORT"
echo "Logs are being written to: app.log"
echo "--------------------------------------------------------"
echo "To view logs in real-time:"
echo "  tail -f app.log"
echo ""
echo "To stop the server:"
echo "  kill $NEW_PID  (or run: kill \$(cat app.pid))"
echo "--------------------------------------------------------"
echo "You can now safely close your SSH session."
