import cv2
import numpy as np

img = cv2.imread("../frontend/public/crop_barcode.jpeg")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# Just the barcode region (bars + numbers)
# Let's crop right to the white box:
# x: ~20..190, y: ~90..270
h, w = gray.shape
print("Gray shape:", h, w)

# Test 1: Resize 2x and 3x
resized2 = cv2.resize(gray, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
cv2.imwrite("../frontend/public/crop_3x.png", resized2)

# Test 2: Otsu threshold
_, otsu = cv2.threshold(resized2, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
cv2.imwrite("../frontend/public/crop_otsu.png", otsu)

# Test 3: Only the white box with quiet zone
# Find white box contours
ret, thresh = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
for i, c in enumerate(contours):
    x, y, bw, bh = cv2.boundingRect(c)
    if bw > 80 and bh > 80:
        print(f"Found white box at x={x}, y={y}, w={bw}, h={bh}")
        box = gray[y:y+bh, x:x+bw]
        # add white border (quiet zone)
        box_bordered = cv2.copyMakeBorder(box, 30, 30, 40, 40, cv2.BORDER_CONSTANT, value=255)
        box_3x = cv2.resize(box_bordered, (box_bordered.shape[1] * 2, box_bordered.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
        cv2.imwrite("../frontend/public/crop_box.png", box_3x)
        _, box_otsu = cv2.threshold(box_3x, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        cv2.imwrite("../frontend/public/crop_box_otsu.png", box_otsu)

bd = cv2.barcode.BarcodeDetector()
for name, f in [('original', gray), ('3x', resized2), ('otsu', otsu)]:
    res = bd.detectAndDecode(f)
    print(f"OpenCV on {name}:", res)
