import os
import time
import threading
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
import uvicorn
import numpy as np
import cv2

app = FastAPI(title="DrishtiScan OCR Service")

# =============================================================================
# Fix 5 (Phase 5 + Cloud Run): Model is loaded ONCE via thread-safe singleton
# and kept in memory for the lifetime of the process.
# Model loading is initiated in background at startup so the HTTP server binds
# to 0.0.0.0:PORT immediately within Cloud Run's startup window.
# =============================================================================
ocr_model = None
model_loaded = False
model_loading = False
model_lock = threading.Lock()

def get_ocr():
    """Thread-safe singleton getter for PaddleOCR.
    Loads once on demand or via background startup thread, and reuses the model instance."""
    global ocr_model, model_loaded, model_loading
    if ocr_model is not None:
        return ocr_model
    with model_lock:
        if ocr_model is not None:
            return ocr_model
        model_loading = True
        print("Initializing PaddleOCR with Phase 5 optimized settings...")
        try:
            from paddleocr import PaddleOCR
            # use_textline_orientation handles angled text lines on cylindrical bottles
            # cpu_threads=6 accelerates multi-core CPU inference
            # enable_mkldnn=False prevents OneDNN PIR kernel conflicts in PaddlePaddle 3.3
            # text_det_limit_side_len=2560: raised from default ~960 so large photos aren't
            #   downscaled before small text is detected (Phase 5 Fix 4)
            # text_rec_score_thresh=0.3: lowered from default ~0.5 so borderline-confidence
            #   text isn't silently dropped — let extraction layer's confidence logic decide (Phase 5 Fix 4)
            ocr_model = PaddleOCR(
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
            ocr_model = None
            model_loaded = False
        finally:
            model_loading = False
        return ocr_model

# =============================================================================
# Phase 5 Fix 4: CLAHE Contrast Enhancement
# Specifically helps dark-background, light-text style labels seen on glossy
# packaging (e.g., dark-background, glossy-label products). Applied before OCR inference.
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
# Phase 5 Fix 4 + Speed Upgrade: Three-tier Image Routing & Tiling Fallback
# 1. Ultra-large images (> 2560px) run tiled OCR at full resolution to preserve fine statutory print.
# 2. Large phone photos (1920-2560px) are scaled to MAX_IMAGE_DIM (1920px) for fast single-pass.
# 3. Standard images (<= 1920px) run single-pass at native resolution.
# =============================================================================
MAX_IMAGE_DIM = 1920   # Controlled maximum dimension for single-pass fast path (preserves aspect ratio)
TILE_THRESHOLD = 2560  # Ultra-large images above this on any side trigger full-resolution tiled OCR
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
    model = get_ocr()
    if model is None:
        return None
    result = model.predict(img)
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

def sort_results_spatially(results):
    """Sort OCR detections in natural visual reading order: top-to-bottom, left-to-right.
    Groups detections into visual rows using vertical center and bounding box height,
    then sorts elements within each row left-to-right by horizontal position.
    Preserves all confidence and metadata.
    """
    if len(results) <= 1:
        return results

    valid_elements = []
    empty_elements = []

    for r in results:
        bbox = r.get("bbox", [])
        if bbox and len(bbox) >= 4:
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)
            height = max(1.0, float(y_max - y_min))
            center_y = (y_min + y_max) / 2.0
            valid_elements.append({
                "item": r,
                "x_min": x_min,
                "x_max": x_max,
                "y_min": y_min,
                "y_max": y_max,
                "center_y": center_y,
                "height": height
            })
        else:
            empty_elements.append(r)

    if not valid_elements:
        return results

    # Initial coarse sort by vertical position then horizontal position
    valid_elements.sort(key=lambda e: (e["y_min"], e["x_min"]))

    # Group into visual rows based on vertical proximity and overlap
    rows = []
    for elem in valid_elements:
        matched_row = None
        for row in rows:
            row_cy = row["center_y"]
            row_h = row["height"]
            vertical_tol = max(row_h, elem["height"]) * 0.5
            if abs(elem["center_y"] - row_cy) <= vertical_tol:
                matched_row = row
                break

        if matched_row is not None:
            matched_row["elements"].append(elem)
            n = len(matched_row["elements"])
            matched_row["center_y"] = ((matched_row["center_y"] * (n - 1)) + elem["center_y"]) / n
            matched_row["height"] = max(matched_row["height"], elem["height"])
        else:
            rows.append({
                "center_y": elem["center_y"],
                "height": elem["height"],
                "elements": [elem]
            })

    # Sort rows top-to-bottom by center_y
    rows.sort(key=lambda r: r["center_y"])

    # Sort elements within each row left-to-right by x_min
    sorted_results = []
    for row in rows:
        row["elements"].sort(key=lambda e: e["x_min"])
        for e in row["elements"]:
            sorted_results.append(e["item"])

    sorted_results.extend(empty_elements)
    return sorted_results

def deduplicate_results(results):
    """Remove duplicate detections from overlapping tiles using bbox IoU.
    Final output is spatially ordered: top-to-bottom, left-to-right.
    """
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

    return sort_results_spatially(kept)


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
    print(f"  - Tiling threshold: {TILE_THRESHOLD}px (ultra-large images > {TILE_THRESHOLD}px use full-res tiling)")
    print(f"  - Controlled downscale: {MAX_IMAGE_DIM}px (images between {MAX_IMAGE_DIM}px and {TILE_THRESHOLD}px)")
    print("  - Model loaded in background worker: YES")
    print("="*50 + "\n")
    # Initiate model warm-up in background thread so HTTP server binds port immediately
    threading.Thread(target=get_ocr, daemon=True).start()

@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "DrishtiScan OCR Microservice",
        "engine": "PaddleOCR 3.7.0 (PP-OCRv6)",
        "ocr_model_loaded": model_loaded
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy" if model_loaded else "initializing",
        "ocr_model_loaded": model_loaded,
        "ocr_model_loading": model_loading,
        "engine": "PaddleOCR 3.7.0 (PP-OCRv6)",
        "device": "CPU",
        "cpuThreads": 6,
        "phase5Enhancements": {
            "clahe": True,
            "routing": "three-tier (tiled >2560px, resized 1920-2560px, native <=1920px)",
            "tilingThreshold": TILE_THRESHOLD,
            "maxImageDim": MAX_IMAGE_DIM,
            "detLimitSideLen": 2560,
            "recScoreThresh": 0.3,
            "modelLoadedOnce": True
        }
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

@app.post("/ocr")
async def perform_ocr(image: UploadFile = File(...)):
    model = get_ocr()
    if model is None:
        return JSONResponse(status_code=503, content={"error": "OCR model is currently initializing or unavailable"})

    # Read image into OpenCV format
    contents = await image.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
         return JSONResponse(status_code=400, content={"error": "Invalid image format"})

    orig_h, orig_w = img.shape[:2]

    # -------------------------------------------------------------------------
    # Issue 8: Execution routing based on ORIGINAL photo dimensions.
    # 1. Ultra-large image (> TILE_THRESHOLD 2560px): preserve full resolution
    #    via tiling so fine statutory print isn't lost to downscaling.
    # 2. Normal large phone photo (> MAX_IMAGE_DIM 1920px): fast single-pass path
    #    via controlled downscale to 1920px.
    # 3. Standard photo (<= MAX_IMAGE_DIM 1920px): single-pass at original scale.
    # -------------------------------------------------------------------------
    if max(orig_h, orig_w) > TILE_THRESHOLD:
        scale = 1.0
        enhanced_img = apply_clahe(img)
        use_tiling = True
    elif max(orig_h, orig_w) > MAX_IMAGE_DIM:
        scale = MAX_IMAGE_DIM / float(max(orig_h, orig_w))
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)
        resized_img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        enhanced_img = apply_clahe(resized_img)
        use_tiling = False
    else:
        scale = 1.0
        enhanced_img = apply_clahe(img)
        use_tiling = False

    start_time = time.time()

    if use_tiling:
        print(f"[OCR] Ultra-large image detected ({orig_w}x{orig_h} > {TILE_THRESHOLD}px), using tiled OCR at full resolution...")
        tiled_results = run_tiled_ocr(enhanced_img)
        formatted_results = []
        for r in tiled_results:
            formatted_results.append({
                "text": r["text"],
                "confidence": r["confidence"],
                "bbox": r.get("bbox", [])
            })
    else:
        # Standard path: single PaddleOCR pass
        result = model.predict(enhanced_img)

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
            "scale": round(scale, 4),
            "maxImageDim": MAX_IMAGE_DIM,
            "detLimitSideLen": 2560,
            "recScoreThresh": 0.3
        },
        "results": sort_results_spatially(formatted_results)
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)

