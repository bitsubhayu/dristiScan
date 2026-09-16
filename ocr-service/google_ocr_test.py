from google.cloud import vision
import sys
import os
import time


def get_box(vertices):
    xs = [v.x for v in vertices]
    ys = [v.y for v in vertices]

    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


def google_ocr(image_path):
    print(f"Reading image: {image_path}")

    if not os.path.exists(image_path):
        print(f"ERROR: Image not found: {image_path}")
        return

    client = vision.ImageAnnotatorClient()

    with open(image_path, "rb") as image_file:
        content = image_file.read()

    image = vision.Image(content=content)

    print("Sending image to Google Cloud Vision...")
    start = time.time()

    response = client.document_text_detection(image=image)

    elapsed = time.time() - start

    if response.error.message:
        print(f"Google Vision ERROR: {response.error.message}")
        return

    print(f"\nGoogle OCR completed in {elapsed:.2f} seconds")

    # Full text
    full_text = response.full_text_annotation.text

    print("\n" + "=" * 70)
    print("FULL OCR TEXT")
    print("=" * 70)
    print(full_text)
    print("=" * 70)

    # Structured text with coordinates
    print("\n" + "=" * 70)
    print("TEXT WITH BOUNDING BOXES")
    print("=" * 70)

    count = 0

    for page in response.full_text_annotation.pages:
        for block in page.blocks:
            for paragraph in block.paragraphs:

                paragraph_text = ""

                for word in paragraph.words:
                    word_text = ""

                    for symbol in word.symbols:
                        word_text += symbol.text

                    paragraph_text += word_text + " "

                paragraph_text = paragraph_text.strip()

                if not paragraph_text:
                    continue

                box = get_box(paragraph.bounding_box.vertices)

                count += 1

                print(f"\n[{count}] {paragraph_text}")
                print(
                    f"    Position: x={box['x']}, y={box['y']}, "
                    f"width={box['width']}, height={box['height']}"
                )

    print("\n" + "=" * 70)
    print(f"TOTAL PARAGRAPHS: {count}")
    print("=" * 70)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage:")
        print("python google_ocr_test.py <image_path>")
        sys.exit(1)

    google_ocr(sys.argv[1])