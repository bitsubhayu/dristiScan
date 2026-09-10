import cv2
import time
from paddleocr import PaddleOCR

print("Testing cpu_threads=6...")
ocr = PaddleOCR(use_textline_orientation=True, lang='en', enable_mkldnn=False, cpu_threads=6)
img = cv2.imread("/mnt/c/Users/subha/OneDrive/Documents/Antigravity_Workspace/DrishtiScan/test_images/bottle_2.jpeg")
t0 = time.time()
res = ocr.predict(img)
t1 = time.time()
print(f"cpu_threads=6 time: {t1-t0:.2f}s, texts count: {len(res[0]['rec_texts'])}")
