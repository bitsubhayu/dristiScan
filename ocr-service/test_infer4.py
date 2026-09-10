import cv2
import numpy as np
from paddleocr import PaddleOCR

ocr = PaddleOCR(lang='en', ocr_version='PP-OCRv4')
img = np.zeros((100, 100, 3), dtype=np.uint8)
try:
    res = ocr.predict(img)
    print('Success:', res)
except Exception as e:
    print('Failed:', str(e))
