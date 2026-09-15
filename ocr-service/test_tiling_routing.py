"""
DrishtiScan — Issue 8 Test: Three-Tier Image Execution Routing & Tiling Fallback

Verifies that:
(a) An image whose longest side is 1200px goes through native-single-pass with scale=1.0, use_tiling=False.
(b) An image whose longest side is 2200px goes through resized-single-pass with scale ≈ 1920/2200, use_tiling=False.
(c) An image whose longest side is 3200px goes through tiled branch with scale=1.0, use_tiling=True.
"""

import sys
import os
import io
import cv2
import numpy as np
from unittest.mock import MagicMock, patch

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

def test_routing_with_fastapi_client():
    from fastapi.testclient import TestClient
    import app

    client = TestClient(app.app)

    # Mock get_ocr and run_tiled_ocr to avoid loading full model during routing tests
    mock_model = MagicMock()
    mock_model.predict.return_value = [{
        'rec_texts': ['SAMPLE TEXT'],
        'rec_scores': [0.95],
        'dt_polys': [[[10, 10], [100, 10], [100, 50], [10, 50]]]
    }]

    mock_tiled_results = [{
        'text': 'FINE PRINT BATCH NO',
        'confidence': 0.96,
        'bbox': [[20, 20], [200, 20], [200, 60], [20, 60]]
    }]

    with patch('app.get_ocr', return_value=mock_model), \
         patch('app.run_tiled_ocr', return_value=mock_tiled_results):

        print("\n=============================================================")
        print("     DRISHTISCAN ISSUE 8: OCR THREE-TIER ROUTING TESTS      ")
        print("=============================================================\n")

        # ---------------------------------------------------------------------
        # Case A: Standard Image (1200x800px <= MAX_IMAGE_DIM 1920)
        # Expected: native single-pass, scale = 1.0, use_tiling = False
        # ---------------------------------------------------------------------
        print("Test A: Standard image (1200x800px, longest side 1200px)...")
        img_1200 = np.zeros((800, 1200, 3), dtype=np.uint8)
        _, buf_1200 = cv2.imencode('.jpg', img_1200)
        resp_a = client.post("/ocr", files={"image": ("test_1200.jpg", io.BytesIO(buf_1200), "image/jpeg")})
        assert resp_a.status_code == 200, f"Expected 200, got {resp_a.status_code}: {resp_a.text}"
        data_a = resp_a.json()
        assert data_a["phase5"]["scale"] == 1.0, f"Expected scale 1.0, got {data_a['phase5']['scale']}"
        assert data_a["phase5"]["tilingUsed"] == False, f"Expected tilingUsed False, got {data_a['phase5']['tilingUsed']}"
        assert data_a["imageWidth"] == 1200
        assert data_a["imageHeight"] == 800
        print(f"  -> scale={data_a['phase5']['scale']}, tilingUsed={data_a['phase5']['tilingUsed']}, branch=native-single-pass (PASSED)")

        # ---------------------------------------------------------------------
        # Case B: Large Phone Photo (2200x1650px, MAX_IMAGE_DIM < size <= TILE_THRESHOLD)
        # Expected: resized single-pass, scale = 1920/2200 ≈ 0.8727, use_tiling = False
        # ---------------------------------------------------------------------
        print("\nTest B: Large phone photo (2200x1650px, longest side 2200px)...")
        img_2200 = np.zeros((1650, 2200, 3), dtype=np.uint8)
        _, buf_2200 = cv2.imencode('.jpg', img_2200)
        resp_b = client.post("/ocr", files={"image": ("test_2200.jpg", io.BytesIO(buf_2200), "image/jpeg")})
        assert resp_b.status_code == 200, f"Expected 200, got {resp_b.status_code}: {resp_b.text}"
        data_b = resp_b.json()
        expected_scale = round(1920.0 / 2200.0, 4)
        assert abs(data_b["phase5"]["scale"] - expected_scale) < 0.001, f"Expected scale ~{expected_scale}, got {data_b['phase5']['scale']}"
        assert data_b["phase5"]["tilingUsed"] == False, f"Expected tilingUsed False, got {data_b['phase5']['tilingUsed']}"
        assert data_b["imageWidth"] == 2200
        assert data_b["imageHeight"] == 1650
        print(f"  -> scale={data_b['phase5']['scale']}, tilingUsed={data_b['phase5']['tilingUsed']}, branch=resized-single-pass (PASSED)")

        # ---------------------------------------------------------------------
        # Case C: Ultra-Large Photo (3200x2400px > TILE_THRESHOLD 2560px)
        # Expected: tiled branch, scale = 1.0 (full resolution), use_tiling = True
        # ---------------------------------------------------------------------
        print("\nTest C: Ultra-large image (3200x2400px, longest side 3200px)...")
        img_3200 = np.zeros((2400, 3200, 3), dtype=np.uint8)
        _, buf_3200 = cv2.imencode('.jpg', img_3200)
        resp_c = client.post("/ocr", files={"image": ("test_3200.jpg", io.BytesIO(buf_3200), "image/jpeg")})
        assert resp_c.status_code == 200, f"Expected 200, got {resp_c.status_code}: {resp_c.text}"
        data_c = resp_c.json()
        assert data_c["phase5"]["scale"] == 1.0, f"Expected scale 1.0, got {data_c['phase5']['scale']}"
        assert data_c["phase5"]["tilingUsed"] == True, f"Expected tilingUsed True, got {data_c['phase5']['tilingUsed']}"
        assert data_c["imageWidth"] == 3200
        assert data_c["imageHeight"] == 2400
        assert len(data_c["results"]) > 0
        assert data_c["results"][0]["text"] == "FINE PRINT BATCH NO"
        print(f"  -> scale={data_c['phase5']['scale']}, tilingUsed={data_c['phase5']['tilingUsed']}, branch=full-resolution-tiled (PASSED)")

        # ---------------------------------------------------------------------
        # Health Check Endpoint Verification
        # ---------------------------------------------------------------------
        print("\nTest D: /health endpoint reports three-tier routing configuration...")
        resp_health = client.get("/health")
        assert resp_health.status_code == 200
        h_data = resp_health.json()
        assert "three-tier" in h_data["phase5Enhancements"]["routing"]
        assert h_data["phase5Enhancements"]["tilingThreshold"] == 2560
        assert h_data["phase5Enhancements"]["maxImageDim"] == 1920
        print(f"  -> health routing: {h_data['phase5Enhancements']['routing']} (PASSED)")

        print("\n=============================================================")
        print("       ALL ISSUE 8 ROUTING TESTS PASSED SUCCESSFULLY!        ")
        print("=============================================================\n")

if __name__ == "__main__":
    test_routing_with_fastapi_client()
