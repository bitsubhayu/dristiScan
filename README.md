# DrishtiScan — Packaged-Commodity Compliance Scanning System

DrishtiScan is an automated legal metrology compliance verification system for packaged commodities in India, enforcing declarations mandated under the **Legal Metrology (Packaged Commodities) Rules, 2011**.

---

## 1. Architecture

The system follows a modular 3-tier architecture:

```text
Product Image
      ↓
React Frontend (Vite) [Port 5173]
      ↓
Node.js Express Backend [Port 8080]
      ↓
Python FastAPI OCR Microservice [Port 8001]
      ↓
Google Cloud Vision OCR (document_text_detection)
      ↓
Normalized OCR Contract { text, confidence, bbox: [[x,y],...] }
      ↓
Evidence-Based Extraction Layer (backend/src/services/extraction.js)
      ↓
Legal Metrology Rule Engine & MongoDB
      ↓
Compliance Audit Report
      ↓
Frontend Dashboard
```

- **OCR Engine**: Google Cloud Vision API (`document_text_detection`)
- **Backend**: Node.js / Express
- **Frontend**: React + Vite
- **Database**: MongoDB Atlas

---

## 2. OCR Service Configuration & Ports

| Component | Host / Port | Environment Variable |
|---|---|---|
| Python OCR Microservice | `http://127.0.0.1:8001` | `PORT=8001` |
| Node.js Express Backend | `http://127.0.0.1:8080` (or `5000`) | `OCR_SERVICE_URL=http://127.0.0.1:8001` |
| React Frontend | `http://127.0.0.1:5173` | `VITE_API_URL=http://127.0.0.1:8080` |

---

## 3. Google Cloud Vision Authentication & Setup

The OCR microservice uses the official Google Cloud Vision Python SDK (`google-cloud-vision`).

### Prerequisites
1. Authenticate with Google Cloud Application Default Credentials (ADC):
   ```bash
   gcloud auth application-default login
   ```
2. Ensure the Vision API is enabled on your project:
   ```bash
   gcloud services enable vision.googleapis.com --project=compliance-ocr-test
   ```

### Google Cloud Billing Notice & Offline Fixture Mode
Live Google Cloud Vision requests require active billing on the target project (`compliance-ocr-test`). If billing verification is pending or disabled on the cloud console, live calls will return `403 PERMISSION_DENIED (BILLING_DISABLED)`.

To allow end-to-end development, extraction testing, and compliance validation while billing is being finalized, the service supports an **Offline Fixture Mode**:

```bash
# Enable offline fixture testing
export USE_OFFLINE_FIXTURES=1
python app.py
```

When `USE_OFFLINE_FIXTURES=1`, the OCR service serves pre-captured normalized Google Cloud Vision responses (located in `ocr-service/test_fixtures/`) adhering to the exact 4-point polygon bounding box contract. During live mode (`USE_OFFLINE_FIXTURES` unset), live API calls are executed and structured error messages are returned if Google Cloud reports billing or authorization issues.

---

## 4. Local Development Startup

### Terminal 1: Python OCR Microservice (WSL or Linux/Windows)
```bash
cd ocr-service
source .venv/bin/activate
PORT=8001 python app.py
```
Or for offline testing mode:
```bash
PORT=8001 USE_OFFLINE_FIXTURES=1 python app.py
```

### Terminal 2: Node.js Backend (Windows PowerShell)
```powershell
cd backend
$env:OCR_SERVICE_URL="http://127.0.0.1:8001"
npm start
```

### Terminal 3: React Frontend (Windows PowerShell)
```powershell
cd frontend
npm run dev
```

---

## 5. Testing & Verification

### Test OCR Microservice Directly
```bash
# Health check (zero-cost, no paid Vision API call)
curl http://127.0.0.1:8001/health

# Single image test via backend
cd backend
$env:OCR_SERVICE_URL="http://127.0.0.1:8001"
node test_ocr_single.js
```

### Verification Highlights
- **OCR Contract**: Every result element strictly adheres to `{ text, confidence, bbox: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] }`.
- **Geometry Compatibility**: Polygon coordinates satisfy `Array.isArray(bbox)` and integrate directly with spatial pairing (`bbox.reduce(...)`) in `backend/src/services/extraction.js`.
- **Provenance**: Extraction declarations report `source: "google_vision_primary"`.
- **Zero Paddle Dependencies**: Obsolete PaddleOCR and PaddlePaddle libraries are completely removed from the active execution path.
