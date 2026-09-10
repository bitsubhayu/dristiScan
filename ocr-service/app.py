import os
import time
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
import uvicorn
from paddleocr import PaddleOCR
import numpy as np
import cv2

app = FastAPI(title="DrishtiScan OCR Service")

# =============================================================================
# Fix 5 (Phase 5): Model is loaded ONCE at module level — not per request.
# This was confirmed correct during Phase 5 debugging. Model weights (~750-815 MB)
# are loaded into memory here and reused for every incoming /ocr request.
# =============================================================================
print("Initializing PaddleOCR...")
try:
    # use_textline_orientation handles angled text lines on cylindrical bottles
    # cpu_threads=6 accelerates multi-core CPU inference
    # enable_mkldnn=False prevents OneDNN PIR kernel conflicts in PaddlePaddle 3.3
    # text_det_limit_side_len=2560: raised from default ~960 so large photos aren't
    #   downscaled before small text is detected (Phase 5 Fix 4)
    # text_rec_score_thresh=0.3: lowered from default ~0.5 so borderline-confidence
    #   text isn't silently dropped — let extraction layer's confidence logic decide (Phase 5 Fix 4)
    ocr = PaddleOCR(
        use_textline_orientation=True,
        lang='en',
        enable_mkldnn=False,
        cpu_threads=6,
        text_det_limit_side_len=2560,
        text_det_limit_type='max',
        text_rec_score_thresh=0.3,
    )
    model_loaded = True
    print("PaddleOCR initialized successfully with Phase 5 optimized settings.")
except Exception as e:
    print(f"Failed to load OCR model: {e}")
    ocr = None
    model_loaded = False

# =============================================================================
# Phase 5 Fix 4: CLAHE Contrast Enhancement
# Specifically helps dark-background, light-text style labels seen on glossy
# bottles (e.g., Optimum Nutrition). Applied before OCR inference.
# =============================================================================
def apply_clahe(img):
    """Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) to improve
    text readability on dark backgrounds, glossy surfaces, and uneven lighting."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l_channel)
    merged = cv2.merge((cl, a_channel, b_channel))
    enhanced = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
    return enhanced

# =============================================================================
# Phase 5 Fix 4: Image Tiling for Large Photos
# For large, high-resolution packaging photos, split into overlapping tiles
# and run OCR on each to avoid losing small dense text (nutrition panels,
# fine print) to internal downscaling.
# =============================================================================
TILE_THRESHOLD = 2560  # Only tile images larger than this on any side
TILE_SIZE = 1920       # Each tile is at most this size
TILE_OVERLAP = 0.15    # 15% overlap between adjacent tiles

def bbox_iou(bbox_a, bbox_b):
    """Compute bounding box IoU between two polygon bboxes (4-point format)."""
    if len(bbox_a) < 4 or len(bbox_b) < 4:
        return 0
    ax_min = min(p[0] for p in bbox_a)
    ax_max = max(p[0] for p in bbox_a)
    ay_min = min(p[1] for p in bbox_a)
    ay_max = max(p[1] for p in bbox_a)

    bx_min = min(p[0] for p in bbox_b)
    bx_max = max(p[0] for p in bbox_b)
    by_min = min(p[1] for p in bbox_b)
    by_max = max(p[1] for p in bbox_b)

    ix_min = max(ax_min, bx_min)
    ix_max = min(ax_max, bx_max)
    iy_min = max(ay_min, by_min)
    iy_max = min(ay_max, by_max)

    if ix_max <= ix_min or iy_max <= iy_min:
        return 0

    inter = (ix_max - ix_min) * (iy_max - iy_min)
    area_a = (ax_max - ax_min) * (ay_max - ay_min)
    area_b = (bx_max - bx_min) * (by_max - by_min)
    union = area_a + area_b - inter

    return inter / union if union > 0 else 0

def create_tiles(img_h, img_w):
    """Generate tile coordinates with overlap for a large image."""
    tiles = []
    step = int(TILE_SIZE * (1 - TILE_OVERLAP))

    for y in range(0, img_h, step):
        for x in range(0, img_w, step):
            x_end = min(x + TILE_SIZE, img_w)
            y_end = min(y + TILE_SIZE, img_h)
            if x_end - x < TILE_SIZE // 2 and x > 0:
                continue
            if y_end - y < TILE_SIZE // 2 and y > 0:
                continue
            tiles.append((x, y, x_end, y_end))

    return tiles

def run_ocr_on_image(img):
    """Run PaddleOCR on a single image and return raw results dict."""
    result = ocr.predict(img)
    if result and isinstance(result, list) and len(result) > 0:
        res_dict = result[0]
        if isinstance(res_dict, dict) and 'rec_texts' in res_dict and 'dt_polys' in res_dict:
            return res_dict
    return None

def run_tiled_ocr(img):
    """Run OCR on overlapping tiles of a large image, then merge and deduplicate."""
    h, w = img.shape[:2]
    tiles = create_tiles(h, w)

    all_results = []

    for (tx, ty, tx_end, ty_end) in tiles:
        tile_img = img[ty:ty_end, tx:tx_end]
        res_dict = run_ocr_on_image(tile_img)

        if res_dict is None:
            continue

        rec_texts = res_dict.get('rec_texts', [])
        rec_scores = res_dict.get('rec_scores', [])
        dt_polys = res_dict.get('dt_polys', [])

        for i in range(len(rec_texts)):
            text = rec_texts[i]
            confidence = float(rec_scores[i]) if i < len(rec_scores) else 0.0
            bbox_arr = dt_polys[i] if i < len(dt_polys) else []

            # Offset bbox to original image coordinates
            if len(bbox_arr) > 0:
                bbox = [[int(pt[0] + tx), int(pt[1] + ty)] for pt in bbox_arr]
            else:
                bbox = []

            all_results.append({
                "text": text,
                "confidence": confidence,
                "bbox": bbox
            })

    # Deduplicate overlapping detections
    return deduplicate_results(all_results)

def deduplicate_results(results):
    """Remove duplicate detections from overlapping tiles using bbox IoU."""
    if len(results) <= 1:
        return results

    sorted_results = sorted(results, key=lambda r: r['confidence'], reverse=True)
    kept = []

    for candidate in sorted_results:
        is_duplicate = False
        for existing in kept:
            if candidate['text'].strip().lower() == existing['text'].strip().lower():
                iou = bbox_iou(candidate['bbox'], existing['bbox'])
                if iou > 0.3:
                    is_duplicate = True
                    break
            iou = bbox_iou(candidate['bbox'], existing['bbox'])
            if iou > 0.7:
                is_duplicate = True
                break

        if not is_duplicate:
            kept.append(candidate)

    return kept


# =============================================================================
# Endpoints
# =============================================================================

@app.on_event("startup")
async def startup_event():
    print("\n" + "="*50)
    print("OCR Engine: PaddleOCR")
    print("OCR Model: PP-OCRv6 Medium (via ocr_version='PP-OCRv6')")
    print("Device: CPU (6 threads)")
    print("Textline Orientation: Enabled")
    print("Phase 5 Enhancements:")
    print("  - CLAHE contrast enhancement: ON")
    print("  - Detection side length limit: 2560")
    print("  - Recognition score threshold: 0.3 (lowered)")
    print(f"  - Tiling threshold: {TILE_THRESHOLD}px")
    print("  - Model loaded once at startup: YES")
    print("="*50 + "\n")

@app.get("/health")
def health_check():
    return {
        "status": "ok" if model_loaded else "error",
        "ocrEngine": "PaddleOCR",
        "model": "PP-OCRv6 Medium",
        "device": "CPU",
        "cpuThreads": 6,
        "phase5Enhancements": {
            "clahe": True,
            "tilingThreshold": TILE_THRESHOLD,
            "detLimitSideLen": 2560,
            "recScoreThresh": 0.3,
            "modelLoadedOnce": True
        }
    }

@app.get("/tips")
def capture_tips():
    """Phase 5 Fix 4: Capture quality guidance for officer/consumer capture screens."""
    return {
        "tips": [
            "Avoid direct flash glare \u2014 use ambient or angled lighting",
            "Hold the camera steady to prevent motion blur",
            "Fill the frame with one panel at a time (front, back, side)",
            "For cylindrical bottles, flatten the label by rotating the product slightly",
            "Ensure text is in focus \u2014 tap to focus on the label area",
            "Photograph each side of the package separately for best accuracy"
        ]
    }

@app.post("/ocr")
async def perform_ocr(image: UploadFile = File(...)):
    if not model_loaded:
        return JSONResponse(status_code=500, content={"error": "OCR model failed to load"})

    # Read image into OpenCV format
    contents = await image.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
         return JSONResponse(status_code=400, content={"error": "Invalid image format"})

    orig_h, orig_w = img.shape[:2]

    # -------------------------------------------------------------------------
    # Phase 5 Fix 4: CLAHE contrast enhancement
    # Improves readability of dark-background labels, glossy/glare-heavy surfaces
    # -------------------------------------------------------------------------
    enhanced_img = apply_clahe(img)

    start_time = time.time()

    # -------------------------------------------------------------------------
    # Phase 5 Fix 4: Tiling for large images
    # If the image exceeds TILE_THRESHOLD, split into overlapping tiles to avoid
    # losing small dense text to internal downscaling
    # -------------------------------------------------------------------------
    use_tiling = max(orig_h, orig_w) > TILE_THRESHOLD

    if use_tiling:
        print(f"[OCR] Large image detected ({orig_w}x{orig_h}), using tiled OCR...")
        formatted_results = run_tiled_ocr(enhanced_img)
    else:
        # Standard path: scale to reasonable size for CPU inference
        max_dim = 2560  # Raised from 1920 to preserve more detail (Phase 5 Fix 4)
        if max(orig_h, orig_w) > max_dim:
            scale = max_dim / float(max(orig_h, orig_w))
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            proc_img = cv2.resize(enhanced_img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        else:
            scale = 1.0
            proc_img = enhanced_img

        # Run PaddleOCR
        result = ocr.predict(proc_img)

        formatted_results = []

        if result and isinstance(result, list) and len(result) > 0:
            res_dict = result[0]
            if isinstance(res_dict, dict) and 'rec_texts' in res_dict and 'dt_polys' in res_dict:
                rec_texts = res_dict.get('rec_texts', [])
                rec_scores = res_dict.get('rec_scores', [])
                dt_polys = res_dict.get('dt_polys', [])

                for i in range(len(rec_texts)):
                    text = rec_texts[i]
                    confidence = float(rec_scores[i]) if i < len(rec_scores) else 0.0
                    bbox_arr = dt_polys[i] if i < len(dt_polys) else []
                    if scale != 1.0 and len(bbox_arr) > 0:
                        bbox = [[int(pt[0] / scale), int(pt[1] / scale)] for pt in bbox_arr]
                    elif len(bbox_arr) > 0:
                        bbox = [[int(pt[0]), int(pt[1])] for pt in bbox_arr]
                    else:
                        bbox = []

                    formatted_results.append({
                        "text": text,
                        "confidence": confidence,
                        "bbox": bbox
                    })

    processing_time = (time.time() - start_time) * 1000

    return {
        "success": True,
        "model": "PP-OCRv6 Medium",
        "processingTimeMs": round(processing_time, 2),
        "imageWidth": orig_w,
        "imageHeight": orig_h,
        "phase5": {
            "claheApplied": True,
            "tilingUsed": use_tiling,
            "detLimitSideLen": 2560,
            "recScoreThresh": 0.3
        },
        "results": formatted_results
    }

@app.get("/tips")
def get_capture_tips():
    """Phase 5 Fix 4: Capture guidance tips for packaging label photography."""
    return {
        "tips": [
            "Avoid direct flash glare on glossy bottles or laminate pouches.",
            "Hold camera steady to avoid motion blur on fine text.",
            "Fill the frame with one panel at a time (front, ingredients, nutritional table).",
            "Ensure label text is reasonably horizontal before photographing.",
            "For curved or cylindrical bottles, capture multiple overlapping photos from different angles."
        ],
        "recommended_min_resolution": "1080p",
        "optimal_lighting": "Diffused daylight or soft indoor lighting"
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "ocr_model_loaded": model_loaded,
        "engine": "PaddleOCR 3.7.0 (PP-OCRv6)"
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

