from paddleocr import PaddleOCR
print("import ok")
try:
    ocr = PaddleOCR(lang="en")
    print("init ok")
except Exception as e:
    print(f"Exception: {e}")
