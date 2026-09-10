from paddleocr import PaddleOCR
import time
import sys
import psutil
import os

def main():
    print('Initializing PaddleOCR (enable_mkldnn=False)...')
    start_time = time.time()
    ocr = PaddleOCR(use_angle_cls=True, lang='en', enable_mkldnn=False)
    print(f'PaddleOCR initialized in {time.time() - start_time:.2f}s')
    
    print('Running inference...')
    start_time = time.time()
    result = ocr.ocr('sample.jpg', cls=True)
    print(f'Inference done in {time.time() - start_time:.2f}s')
    
    print('Result:')
    for line in result:
        print(line)

    process = psutil.Process(os.getpid())
    print(f'Memory usage: {process.memory_info().rss / 1024 / 1024:.2f} MB')

if __name__ == '__main__':
    main()
