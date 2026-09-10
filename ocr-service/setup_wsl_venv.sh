#!/bin/bash
cd /mnt/c/Users/subha/OneDrive/Documents/Antigravity_Workspace/DrishtiScan/ocr-service
rm -rf .venv
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install fastapi uvicorn python-multipart paddlepaddle paddleocr opencv-python-headless
echo "VENV_SETUP_SUCCESSFUL"
