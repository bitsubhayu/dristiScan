# DrishtiScan OCR Proof-of-Concept

This project is the first technical milestone of the DrishtiScan packaged-commodity compliance scanner. It isolates and tests the **PaddleOCR PP-OCRv6 Medium** model.

## Architecture

This Proof-of-Concept is built using a 3-tier architecture:
1. **Frontend**: React (Vite)
2. **Backend**: Node.js (Express)
3. **OCR Service**: Python (FastAPI + PaddleOCR)

The backend acts as a simple proxy, receiving multipart image uploads from the frontend and forwarding them to the Python OCR service.

## Requirements

- Node.js >= 24
- Python >= 3.11 (Currently running on 3.13)
- Windows OS

## Installation

### 1. Python OCR Service
```bash
cd ocr-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install paddlepaddle paddleocr>=3.7.0 fastapi uvicorn python-multipart opencv-python
```

### 2. Node.js Backend
```bash
cd backend
npm install
```

### 3. React Frontend
```bash
cd frontend
npm install
```

## Running the Application (Hybrid Windows/WSL)

Due to a known framework bug in `PaddlePaddle 3.x` on Windows CPUs, the Python OCR service **must be run inside WSL (Windows Subsystem for Linux)**. The frontend and backend can continue to run on Windows.

### Step 1: Start Frontend and Backend (Windows)
Open a normal Windows PowerShell in the project root and run:
```powershell
.\run_all.ps1
```
**Terminal 2 (Node Backend):**
```bash
cd backend
npm start
```

**Terminal 3 (React Frontend):**
```bash
cd frontend
npm run dev
```

## Model Information
- **OCR Engine**: PaddleOCR
- **Version**: >= 3.7.0
- **Model**: PP-OCRv6 Medium (Explicitly initialized)
- **Device**: CPU

## Testing an Image

1. Open `http://localhost:5173` in your browser.
2. Click "Select Image" or drag and drop a product label image.
3. Click "RUN OCR".
4. The image will be processed by the Python service, and bounding boxes will be drawn over the detected text regions.

## Troubleshooting

- **Python OCR Service Fails to Start**: Ensure the virtual environment is activated and all dependencies are installed. Ensure port 8000 is available.
- **Backend Cannot Reach OCR Service**: Ensure the Python OCR service is running on `http://localhost:8000`.
- **CORS Errors**: The backend has CORS enabled, but ensure you are accessing the frontend from `http://localhost:5173`.
