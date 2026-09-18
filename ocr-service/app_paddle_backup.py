import os
import time
import threading
import asyncio
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
try:
    from starlette.concurrency import run_in_threadpool
except ImportError:
    run_in_threadpool = asyncio.to_thread
import uvicorn
import numpy as np
import cv2

app = FastAPI(title="DrishtiScan OCR Service")

# =============================================================================
# Fix 5 (Phase 5 + Cloud Run): Model is loaded ONCE via thread-safe singleton
# and kept in memory for the lifetime of the process.
# Model loading is initiated in background at startup so the HTTP server binds
# to 0.0.0.0:PORT immediately within Cloud Run's startup window.
# Phase 1: inference_lock ensures serialized, thread-safe access to PaddlePredictor.
# =============================================================================
ocr_model = None
model_loaded = False
model_loading = False
model_lock = threading.Lock()
inference_lock = threading.Lock()

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

def run_ocr_on_image(img, model=None):
    """Run PaddleOCR on a single image and return raw results dict, serialized by inference_lock."""
    if model is None:
        model = get_ocr()
    if model is None:
        return None
    with inference_lock:
        result = model.predict(img)
    if result and isinstance(result, list) and len(result) > 0:
        res_dict = result[0]
        if isinstance(res_dict, dict) and 'rec_texts' in res_dict and 'dt_polys' in res_dict:
            return res_dict
    return None

def sort_reading_order(results):
    """
    Phase 1 Fix 2: Reconstruct deterministic reading order from raw OCR bounding boxes.

    1. Calculates spatial coordinates (x_min, x_max, y_min, y_max, height, width, centers).
    2. Detects distinct visual columns/panels using horizontal occupancy profile (vertical gutters).
    3. Within each column, groups text into visual lines using vertical proximity without chaining.
    4. Ensures tokens on the same line do not collide horizontally.
    5. Sorts columns in logical reading order (left-to-right).
    6. Within each line, sorts tokens left-to-right.
    7. Preserves the exact original dictionary schema:
       {"text": ..., "confidence": ..., "bbox": ...}
    """
    if not results or len(results) <= 1:
        return results

    annotated = []
    for idx, item in enumerate(results):
        bbox = item.get("bbox", [])
        if len(bbox) >= 4:
            xs = [pt[0] for pt in bbox]
            ys = [pt[1] for pt in bbox]
            x_min = min(xs)
            x_max = max(xs)
            y_min = min(ys)
            y_max = max(ys)
            height = max(1.0, float(y_max - y_min))
            width = max(1.0, float(x_max - x_min))
            y_center = (y_min + y_max) / 2.0
            x_center = (x_min + x_max) / 2.0
        else:
            x_min = 0.0
            x_max = 0.0
            y_min = 0.0
            y_max = 0.0
            height = 1.0
            width = 1.0
            y_center = 0.0
            x_center = 0.0

        annotated.append({
            "orig": item,
            "orig_idx": idx,
            "x_min": x_min,
            "x_max": x_max,
            "y_min": y_min,
            "y_max": y_max,
            "height": height,
            "width": width,
            "y_center": y_center,
            "x_center": x_center,
        })

    # Step A: Detect column boundaries using horizontal projection profile (vertical gutters)
    max_x = int(max(a["x_max"] for a in annotated)) + 10
    occupancy = [0] * max_x
    for a in annotated:
        x1 = max(0, int(a["x_min"]))
        x2 = min(max_x, int(a["x_max"]))
        for x in range(x1, x2):
            occupancy[x] += 1

    min_gutter = 10  # Minimum 10px continuous vertical gutter to separate columns
    cut_points = []
    in_gap = False
    gap_start = 0
    for x in range(max_x):
        if occupancy[x] == 0:
            if not in_gap:
                in_gap = True
                gap_start = x
        else:
            if in_gap:
                in_gap = False
                if (x - gap_start) >= min_gutter:
                    cut_points.append((gap_start + x) / 2.0)

    def get_col_idx(item):
        for c_idx, cut in enumerate(cut_points):
            if item["x_center"] < cut:
                return c_idx
        return len(cut_points)

    columns = [[] for _ in range(len(cut_points) + 1)]
    for item in annotated:
        columns[get_col_idx(item)].append(item)

    columns = [col for col in columns if col]

    # Step B: Line grouping within each column
    def sort_column_lines(col_items):
        col_items.sort(key=lambda a: (a["y_center"], a["x_min"]))
        lines = []
        for item in col_items:
            placed = False
            for line in lines:
                # Two items on the same visual line cannot overlap horizontally
                has_h_overlap = False
                for other in line["items"]:
                    overlap_x = max(0.0, min(item["x_max"], other["x_max"]) - max(item["x_min"], other["x_min"]))
                    min_w = min(item["width"], other["width"])
                    if min_w > 0 and (overlap_x / min_w) > 0.25:
                        has_h_overlap = True
                        break

                if has_h_overlap:
                    continue

                line_y_center = line["y_center_sum"] / line["count"]
                line_avg_h = line["height_sum"] / line["count"]
                tol = 0.5 * min(item["height"], line_avg_h)

                if abs(item["y_center"] - line_y_center) <= tol:
                    line["items"].append(item)
                    line["y_center_sum"] += item["y_center"]
                    line["height_sum"] += item["height"]
                    line["count"] += 1
                    placed = True
                    break

            if not placed:
                lines.append({
                    "items": [item],
                    "y_center_sum": item["y_center"],
                    "height_sum": item["height"],
                    "count": 1
                })

        lines.sort(key=lambda l: (l["y_center_sum"] / l["count"]))

        ordered_col = []
        for l in lines:
            l["items"].sort(key=lambda a: (a["x_min"], a["orig_idx"]))
            for a in l["items"]:
                ordered_col.append(a["orig"])
        return ordered_col

    # Step C: Flatten columns in natural reading order (left-to-right)
    ordered_all = []
    for col in columns:
        ordered_all.extend(sort_column_lines(col))

    return ordered_all

def run_tiled_ocr(img, model=None):
    """Run OCR on overlapping tiles of a large image, then merge and deduplicate."""
    if model is None:
        model = get_ocr()
    h, w = img.shape[:2]
    tiles = create_tiles(h, w)

    all_results = []

    for (tx, ty, tx_end, ty_end) in tiles:
        tile_img = img[ty:ty_end, tx:tx_end]
        res_dict = run_ocr_on_image(tile_img, model=model)

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
    deduped = deduplicate_results(all_results)
    # Reconstruct reading order after global tile offset and deduplication
    return sort_reading_order(deduped)

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
            "tilingThreshold": TILE_THRESHOLD,
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

def _process_ocr(contents: bytes) -> dict:
    """
    Synchronous CPU-bound processing function executed inside Starlette threadpool.
    Serializes inference via inference_lock and applies deterministic reading order.
    """
    model = get_ocr()
    if model is None:
        raise RuntimeError("OCR model is unavailable or failed to initialize")

    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image format")

    orig_h, orig_w = img.shape[:2]

    # Phase 5 Fix 4: CLAHE contrast enhancement
    enhanced_img = apply_clahe(img)

    start_time = time.time()

    # Phase 5 Fix 4: Tiling for large images
    use_tiling = max(orig_h, orig_w) > TILE_THRESHOLD

    if use_tiling:
        print(f"[OCR] Large image detected ({orig_w}x{orig_h}), using tiled OCR...")
        formatted_results = run_tiled_ocr(enhanced_img, model=model)
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

        # Run PaddleOCR (serialized by inference_lock inside run_ocr_on_image)
        res_dict = run_ocr_on_image(proc_img, model=model)

        formatted_results = []

        if res_dict and isinstance(res_dict, dict) and 'rec_texts' in res_dict and 'dt_polys' in res_dict:
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

        # Phase 1 Fix 2: Reconstruct reading order deterministically
        formatted_results = sort_reading_order(formatted_results)

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

@app.post("/ocr")
async def perform_ocr(image: UploadFile = File(...)):
    # Phase 1 Fix 1: If model is not loaded yet, verify non-blocking availability
    if not model_loaded:
        model = get_ocr()
        if model is None:
            return JSONResponse(
                status_code=503,
                content={"error": "OCR model is currently initializing or unavailable"}
            )

    # Read uploaded file contents asynchronously without blocking event loop
    contents = await image.read()
    if not contents:
        return JSONResponse(status_code=400, content={"error": "Empty image payload"})

    try:
        # Phase 1 Fix 1: Offload CPU-bound inference to Starlette threadpool
        # so the FastAPI event loop stays fully responsive to /health and other routes
        result_payload = await run_in_threadpool(_process_ocr, contents)
        return result_payload
    except ValueError as ve:
        return JSONResponse(status_code=400, content={"error": str(ve)})
    except Exception as e:
        print(f"[OCR Service Error]: {e}")
        return JSONResponse(status_code=500, content={"error": f"OCR processing failed: {str(e)}"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)

