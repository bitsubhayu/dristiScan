import cv2

img = cv2.imread("../test_images/test_barcode.jpeg")
print("Original shape:", img.shape)

# Let's find white rectangular regions
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
crop = img[330:520, 500:700]
cv2.imwrite("../frontend/public/crop_barcode.jpeg", crop)
print("Crop shape:", crop.shape)

bd = cv2.barcode.BarcodeDetector()
res = bd.detectAndDecode(crop)
print("OpenCV on crop:", res)

# Check with zbar if available
try:
    from pyzbar.pyzbar import decode
    zres = decode(crop)
    print("Pyzbar on crop:", zres)
except Exception as e:
    print("pyzbar:", e)
