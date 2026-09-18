#!/bin/bash
echo "=== Checking Python environment for Google Cloud Vision & FastAPI ==="
which python3
python3 -c "import google.cloud.vision, fastapi; print('System python has Google Cloud Vision & FastAPI')" 2>/dev/null || echo "No Google Cloud Vision in system python"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for venv_path in "$SCRIPT_DIR/.venv" "$SCRIPT_DIR/.venv"* ~/.venv* ~/venv* ; do
    if [ -f "$venv_path/bin/python" ]; then
        echo "Testing $venv_path..."
        "$venv_path/bin/python" -c "import google.cloud.vision, fastapi; print('Found working Google Vision venv:', '$venv_path')" 2>/dev/null || echo "Not complete: $venv_path"
    fi
done
