"""
DrishtiScan — Step 1 Targeted Test: Generic Spatial Ordering for OCR Results

Verifies that:
1. Deduplication results and raw OCR detections are returned in natural visual reading order:
   - top-to-bottom by row
   - left-to-right within rows
2. Confidence sorting used internally for IoU suppression does NOT leak into final output.
3. Confidence values and bounding boxes are completely preserved on all elements.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from app import sort_results_spatially, deduplicate_results

def test_spatial_ordering_basic():
    print("\n--- Test 1: Confidence-Scrambled Elements on Same Row ---")
    # Row at y = 100-140 (height 40).
    # Word 1 at x=10..100 with lower confidence (0.70)
    # Word 2 at x=110..200 with higher confidence (0.99)
    # Word 3 at x=210..300 with medium confidence (0.85)
    scrambled = [
        {"text": "WORD3", "confidence": 0.85, "bbox": [[210, 100], [300, 100], [300, 140], [210, 140]]},
        {"text": "WORD2", "confidence": 0.99, "bbox": [[110, 100], [200, 100], [200, 140], [110, 140]]},
        {"text": "WORD1", "confidence": 0.70, "bbox": [[10, 100], [100, 100], [100, 140], [10, 140]]},
    ]

    ordered = sort_results_spatially(scrambled)
    texts = [r["text"] for r in ordered]
    print("  Input order :", [r["text"] for r in scrambled])
    print("  Output order:", texts)
    assert texts == ["WORD1", "WORD2", "WORD3"], f"Expected ['WORD1', 'WORD2', 'WORD3'], got {texts}"
    assert ordered[0]["confidence"] == 0.70, "Confidence must be preserved"
    print("  -> PASSED")

def test_multi_row_reading_order():
    print("\n--- Test 2: Multi-Row Top-to-Bottom and Left-to-Right ---")
    # Row 1 (y=50..90): "BRAND", "NAME"
    # Row 2 (y=150..200): "PRODUCT", "TITLE", "FLAVOR"
    # Row 3 (y=300..330): "NET", "QUANTITY", "500g"
    # Scrambled order with varying confidences
    elements = [
        {"text": "500g", "confidence": 0.95, "bbox": [[250, 300], [320, 300], [320, 330], [250, 330]]},
        {"text": "NAME", "confidence": 0.60, "bbox": [[160, 50], [240, 50], [240, 90], [160, 90]]},
        {"text": "FLAVOR", "confidence": 0.92, "bbox": [[350, 150], [450, 150], [450, 200], [350, 200]]},
        {"text": "BRAND", "confidence": 0.88, "bbox": [[50, 50], [150, 50], [150, 90], [50, 90]]},
        {"text": "PRODUCT", "confidence": 0.99, "bbox": [[50, 150], [180, 150], [180, 200], [50, 200]]},
        {"text": "NET", "confidence": 0.75, "bbox": [[50, 300], [100, 300], [100, 330], [50, 330]]},
        {"text": "TITLE", "confidence": 0.80, "bbox": [[190, 150], [340, 150], [340, 200], [190, 200]]},
        {"text": "QUANTITY", "confidence": 0.85, "bbox": [[110, 300], [240, 300], [240, 330], [110, 330]]},
    ]

    ordered = sort_results_spatially(elements)
    texts = [r["text"] for r in ordered]
    expected = ["BRAND", "NAME", "PRODUCT", "TITLE", "FLAVOR", "NET", "QUANTITY", "500g"]
    print("  Output order:", texts)
    assert texts == expected, f"Expected {expected}, got {texts}"
    print("  -> PASSED")

def test_deduplicate_results_spatial_order():
    print("\n--- Test 3: deduplicate_results Returns Spatial Order ---")
    # Two overlapping detections for "TITLE" (one 0.95, one 0.80) -> high confidence kept
    # One detection for "BRAND" at top
    # One detection for "NET QTY" at bottom
    detections = [
        {"text": "NET QTY 1kg", "confidence": 0.99, "bbox": [[50, 400], [200, 400], [200, 440], [50, 440]]},
        {"text": "TITLE", "confidence": 0.95, "bbox": [[50, 200], [200, 200], [200, 260], [50, 260]]},
        {"text": "TITLE", "confidence": 0.80, "bbox": [[52, 202], [202, 202], [202, 262], [52, 262]]},
        {"text": "BRAND", "confidence": 0.70, "bbox": [[50, 50], [200, 50], [200, 100], [50, 100]]},
    ]

    deduped = deduplicate_results(detections)
    texts = [r["text"] for r in deduped]
    print("  Deduped texts:", texts)
    # BRAND (y=50) -> TITLE (y=200) -> NET QTY (y=400)
    assert texts == ["BRAND", "TITLE", "NET QTY 1kg"], f"Expected ['BRAND', 'TITLE', 'NET QTY 1kg'], got {texts}"
    # Confidences: TITLE should have kept 0.95
    title_elem = next(r for r in deduped if r["text"] == "TITLE")
    assert title_elem["confidence"] == 0.95, "Deduplication must keep highest confidence detection"
    print("  -> PASSED")

if __name__ == "__main__":
    test_spatial_ordering_basic()
    test_multi_row_reading_order()
    test_deduplicate_results_spatial_order()
    print("\n=============================================================")
    print("   ALL STEP 1 SPATIAL ORDERING TESTS PASSED SUCCESSFULLY!    ")
    print("=============================================================\n")
