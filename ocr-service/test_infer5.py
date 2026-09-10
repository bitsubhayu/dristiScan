from paddleocr import PaddleOCR

def main():
    print('Initializing PaddleOCR...')
    ocr = PaddleOCR(use_angle_cls=True, lang='en')
    print('PaddleOCR initialized!')
    
    # Just pass a string path if we have an image
    # We will just see if init succeeds first
    print('Ready to predict')

if __name__ == '__main__':
    main()
