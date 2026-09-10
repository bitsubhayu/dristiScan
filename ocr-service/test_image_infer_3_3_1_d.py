from paddleocr import PaddleOCR
import time
import sys
import psutil
import os

def main():
    print('Initializing PaddleOCR (enable_mkldnn=False)...')
    start_time = time.time()
    # For paddleocr 3.x, use_textline_orientation is used instead of use_angle_cls
    ocr = PaddleOCR(use_textline_orientation=True, lang='en', enable_mkldnn=False)
    print(f'PaddleOCR initialized in {time.time() - start_time:.2f}s')
    
    print('Running inference...')
    start_time = time.time()
    # cls argument might be deprecated in 3.x predict, let's just run .ocr(img)
    result = ocr.predict('sample.jpg')
    print(f'Inference done in {time.time() - start_time:.2f}s')
    
    print('Result type:', type(result))
    
    print(result[0])
    
    process = psutil.Process(os.getpid())
    print(f'Memory usage: {process.memory_info().rss / 1024 / 1024:.2f} MB')

if __name__ == '__main__':
    main()
