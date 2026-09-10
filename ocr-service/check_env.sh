#!/bin/bash
echo "=== Searching for Python with PaddleOCR & FastAPI ==="
which python3
python3 -c "import paddleocr; print('System python has paddleocr')" 2>/dev/null || echo "No paddleocr in system"

for venv_path in /mnt/c/Users/subha/OneDrive/Documents/Antigravity_Workspace/DrishtiScan/ocr-service/.venv* ~/.venv* ~/venv* ; do
    if [ -f "$venv_path/bin/python" ]; then
        echo "Testing $venv_path..."
        "$venv_path/bin/python" -c "import paddleocr, fastapi; print('Found working OCR venv:', '$venv_path')" 2>/dev/null || echo "Not complete: $venv_path"
    fi
done
