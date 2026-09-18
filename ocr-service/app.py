import os
import time

from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from google_vision_provider import google_vision_ocr, get_vision_client


from contextlib import asynccontextmanager

_client_ready = False
_client_init_error = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client_ready, _client_init_error
    print("=" * 70)
    print("DrishtiScan OCR Service")
    print("OCR Engine: Google Cloud Vision")
    print(f"Port: {os.environ.get('PORT', 8001)}")
    print(f"Offline Fixture Mode: {os.environ.get('USE_OFFLINE_FIXTURES') == '1'}")
    print("=" * 70)

    try:
        get_vision_client()
        _client_ready = True
        _client_init_error = None
        print("[Google Vision] Client initialized successfully")
        print("[Google Vision] OCR service ready")
    except Exception as e:
        _client_ready = False
        _client_init_error = str(e)
        print(f"[Google Vision] Client initialization warning: {e}")
    yield


app = FastAPI(
    title="DrishtiScan Google Vision OCR Service",
    description="Dedicated Google Cloud Vision OCR microservice for DrishtiScan packaged-commodity compliance",
    version="2.0.0",
    lifespan=lifespan
)


@app.get("/")
async def root():
    return {
        "success": True,
        "service": "DrishtiScan OCR Service",
        "engine": "Google Cloud Vision",
        "model": "Google Cloud Vision Document Text Detection",
        "clientReady": _client_ready,
        "offlineFixtureMode": os.environ.get("USE_OFFLINE_FIXTURES") == "1",
        "status": "running"
    }


@app.get("/health")
async def health():
    """
    Health check endpoint.
    Verifies that the process is running and whether the Vision client
    is initialized without performing a paid OCR request.
    """
    if _client_ready or os.environ.get("USE_OFFLINE_FIXTURES") == "1":
        return {
            "status": "healthy",
            "engine": "Google Cloud Vision",
            "model": "Google Cloud Vision Document Text Detection",
            "clientReady": _client_ready,
            "offlineFixtureMode": os.environ.get("USE_OFFLINE_FIXTURES") == "1"
        }
    else:
        return JSONResponse(
            status_code=503,
            content={
                "status": "degraded",
                "engine": "Google Cloud Vision",
                "clientReady": False,
                "error": _client_init_error or "Google Vision client not initialized",
                "offlineFixtureMode": False
            }
        )


@app.get("/tips")
async def tips():
    return {
        "tips": [
            "Use a clear, well-lit image",
            "Keep the product label as flat as possible",
            "Avoid reflections and glare",
            "Ensure text is large enough to read"
        ]
    }


def process_ocr(contents: bytes, filename: str = None):
    """
    Process an image using Google Cloud Vision OCR.
    """
    start_time = time.time()
    results = google_vision_ocr(contents, filename=filename)
    processing_time_ms = round((time.time() - start_time) * 1000, 2)

    return {
        "success": True,
        "model": "Google Cloud Vision",
        "processingTimeMs": processing_time_ms,
        "totalDetectedLines": len(results),
        "results": results
    }


@app.post("/ocr")
async def ocr(image: UploadFile = File(...)):
    """
    OCR endpoint compatible with the existing Node.js OCR client.
    Expected multipart field:
        image
    """
    try:
        if not image:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "No image provided",
                    "model": "Google Cloud Vision",
                    "results": []
                }
            )

        contents = await image.read()

        if not contents:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Uploaded image is empty",
                    "model": "Google Cloud Vision",
                    "results": []
                }
            )

        print(
            f"[OCR] Processing {image.filename} ({len(contents)} bytes)"
        )

        result = process_ocr(contents, filename=image.filename)

        print(
            f"[OCR] Completed {image.filename}: "
            f"{result['totalDetectedLines']} results "
            f"in {result['processingTimeMs']} ms"
        )

        return JSONResponse(content=result)

    except RuntimeError as re:
        err_msg = str(re)
        print(f"[OCR RuntimeError] {err_msg}")

        # Differentiate billing / quota / permission issues
        is_billing = "BILLING_DISABLED" in err_msg or "billing" in err_msg.lower()
        status_code = 403 if is_billing else 500

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": err_msg,
                "code": "BILLING_DISABLED" if is_billing else "OCR_ERROR",
                "model": "Google Cloud Vision",
                "results": []
            }
        )
    except Exception as e:
        print(f"[OCR Exception] {type(e).__name__}: {e}")

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "model": "Google Cloud Vision",
                "results": []
            }
        )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8001))

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port
    )