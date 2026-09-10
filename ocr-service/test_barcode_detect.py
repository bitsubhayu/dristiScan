import cv2

img = cv2.imread("../test_images/test_barcode.jpeg")
print("Image shape:", img.shape if img is not None else "None")

bd = cv2.barcode.BarcodeDetector()
res = bd.detectAndDecode(img)
print("OpenCV Barcode result:", res)
