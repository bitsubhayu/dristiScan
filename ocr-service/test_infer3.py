import paddle
paddle.set_flags({'FLAGS_use_mkldnn': 0})

import cv2
import numpy as np
from paddleocr import PaddleOCR

ocr = PaddleOCR(lang='en')
img = np.zeros((100, 100, 3), dtype=np.uint8)
try:
    res = ocr.predict(img)
    print('Success:', res)
except Exception as e:
    print('Failed:', str(e))
