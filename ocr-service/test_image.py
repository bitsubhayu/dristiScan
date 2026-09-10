import sys
import time
import cv2
from paddleocr import PaddleOCR

def test_local_image(image_path):
    print("OCR TEST")
    print("-" * 30)
    
    try:
        print("Initializing PaddleOCR...")
        # Explicitly request PP-OCRv6
        ocr = PaddleOCR(lang='en')
        print("Model: PP-OCRv6 Medium")
        print("Device: CPU")
        
        img = cv2.imread(image_path)
        if img is None:
            print(f"Error: Could not read image at {image_path}")
            return
            
        start_time = time.time()
        result = ocr.predict(img)
        end_time = time.time()
        
        processing_time = end_time - start_time
        print(f"Processing time: {processing_time:.2f} seconds\n")
        
        if result and result[0]:
            detected_regions = result[0]
            print(f"Detected regions: {len(detected_regions)}\n")
            
            for idx, line in enumerate(detected_regions):
                bbox = line[0]
                text = line[1][0]
                confidence = line[1][1]
                print(f"{idx + 1}. Text: \"{text}\"")
                print(f"   Confidence: {confidence:.2f}")
                print(f"   Bounding box: {bbox}\n")
        else:
            print("Detected regions: 0\n")
            
    except Exception as e:
         print(f"Error during OCR testing: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_image.py <path_to_image>")
        sys.exit(1)
        
    test_local_image(sys.argv[1])
