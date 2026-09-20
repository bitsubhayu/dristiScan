import os
import json
from google.cloud import vision

_client = None


def get_vision_client():
    """
    Thread-safe client singleton for Google Cloud Vision.
    Reuses the client instance across requests.
    """
    global _client
    if _client is None:
        _client = vision.ImageAnnotatorClient()
    return _client


def get_box(vertices):
    """
    Convert Google Vision bounding-box vertices into
    the 4-point polygon format expected by the existing
    DrishtiScan extraction pipeline.

    Output:
        [
            [x1, y1],
            [x2, y2],
            [x3, y3],
            [x4, y4]
        ]
    """
    return [
        [int(getattr(vertex, "x", 0) or 0), int(getattr(vertex, "y", 0) or 0)]
        for vertex in vertices
    ]


def load_fixture(fixture_name="google_vision_bottle_1.json"):
    """
    Load pre-captured Google Vision OCR fixture for offline testing.
    """
    fixtures_dir = os.path.join(os.path.dirname(__file__), "test_fixtures")
    fixture_path = os.path.join(fixtures_dir, fixture_name)

    if not os.path.exists(fixture_path):
        raise FileNotFoundError(f"Fixture file not found: {fixture_path}")

    with open(fixture_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data.get("results", [])


def google_vision_ocr(image_bytes: bytes, filename: str = None):
    """
    Run Google Cloud Vision document OCR and normalize
    the result into the OCR contract expected by DrishtiScan.

    Output:
        [
            {
                "text": "...",
                "confidence": 0.97,
                "bbox": [
                    [x1, y1],
                    [x2, y2],
                    [x3, y3],
                    [x4, y4]
                ]
            }
        ]
    """
    # 1. Check for explicit offline fixture mode
    if os.environ.get("USE_OFFLINE_FIXTURES") == "1":
        fixture_name = "google_vision_bottle_1.json"
        if filename:
            fn = filename.lower()
            if "bottle_2" in fn:
                fixture_name = "google_vision_bottle_2.json"
            elif "bottle_3" in fn or "coke" in fn or "cola" in fn:
                fixture_name = "google_vision_bottle_3.json"
        print(f"[Google Vision Provider] Offline fixture mode active (USE_OFFLINE_FIXTURES=1). Returning fixture: {fixture_name}")
        return load_fixture(fixture_name)

    # 2. Live Google Cloud Vision API execution
    try:
        client = get_vision_client()
        image = vision.Image(content=image_bytes)
        response = client.document_text_detection(image=image)
    except Exception as e:
        err_str = str(e)
        if "BILLING_DISABLED" in err_str or "billing to be enabled" in err_str:
            raise RuntimeError(
                "Google Cloud Vision API error: BILLING_DISABLED. "
                "Google Cloud billing is disabled on the project. "
                "Please enable billing in Google Cloud Console. "
                "To test the pipeline offline, set USE_OFFLINE_FIXTURES=1."
            ) from e
        elif "PERMISSION_DENIED" in err_str:
            raise RuntimeError(
                f"Google Cloud Vision API error: PERMISSION_DENIED. {err_str}"
            ) from e
        raise

    if response.error.message:
        err_msg = response.error.message
        if "billing" in err_msg.lower():
            raise RuntimeError(
                f"Google Cloud Vision API error: BILLING_DISABLED. {err_msg}. "
                "To test the pipeline offline, set USE_OFFLINE_FIXTURES=1."
            )
        raise RuntimeError(
            f"Google Cloud Vision API error: {err_msg}"
        )

    results = []
    annotation = response.full_text_annotation

    if not annotation:
        return results

    for page in annotation.pages:
        for block in page.blocks:
            for paragraph in block.paragraphs:

                paragraph_text = ""
                word_confidences = []

                for word in paragraph.words:
                    word_text = "".join(symbol.text for symbol in word.symbols)
                    paragraph_text += word_text + " "

                    # Google Vision provides confidence at word level.
                    if word.confidence is not None and word.confidence > 0:
                        word_confidences.append(word.confidence)

                paragraph_text = paragraph_text.strip()

                if not paragraph_text:
                    continue

                bbox = get_box(paragraph.bounding_box.vertices)

                if word_confidences:
                    confidence = round(sum(word_confidences) / len(word_confidences), 4)
                else:
                    confidence = None

                results.append({
                    "text": paragraph_text,
                    "confidence": confidence,
                    "bbox": bbox,
                })

    return results