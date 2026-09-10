import cv2

img = cv2.imread("../test_images/test_barcode.jpeg")
crop = img[340:620, 500:720]
cv2.imwrite("../frontend/public/crop_barcode.jpeg", crop)
print("Crop shape:", crop.shape)
