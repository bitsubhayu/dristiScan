#!/bin/bash
set -e
echo "Creating virtual environment using Python 3.11..."
rm -rf .venv
python3.11 -m venv .venv
echo "Activating virtual environment..."
source .venv/bin/activate
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install paddlepaddle paddleocr>=3.7.0 fastapi uvicorn python-multipart opencv-python
echo "Setup complete."
