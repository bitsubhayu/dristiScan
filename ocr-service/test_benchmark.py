import cv2
import time
import numpy as np
from paddleocr import PaddleOCR

print("Loading PaddleOCR...")
ocr = PaddleOCR(use_textline_orientation=True, lang='en', enable_mkldnn=False)
img_path = "/mnt/c/Users/subha/OneDrive/Documents/Antigravity_Workspace/DrishtiScan/test_images/bottle_2.jpeg"
img = cv2.imread(img_path)
print("Original shape:", img.shape)

# Test 1: Direct
t0 = time.time()
res1 = ocr.predict(img)
t1 = time.time()
print(f"Direct predict time: {t1-t0:.2f}s, texts count: {len(res1[0]['rec_texts'])}")

# Test 2: Resized to max 1280
scale = 1280.0 / max(img.shape[:2]) if max(img.shape[:2]) > 1280 else 1.0
img_small = cv2.resize(img, (int(img.shape[1]*scale), int(img.shape[0]*scale)), interpolation=cv2.INTER_AREA) if scale < 1.0 else img
t2 = time.time()
res2 = ocr.predict(img_small)
t3 = time.time()
print(f"Resized predict time: {t3-t2:.2f}s, texts count: {len(res2[0]['rec_texts'])}")
print("Sample texts from resized:", res2[0]['rec_texts'][:10])
