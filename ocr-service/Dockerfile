FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Install system dependencies required by PaddlePaddle and OpenCV in headless Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download and cache PaddleOCR models during Docker build into /root/.paddlex
# This eliminates cold network downloads at container startup
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_textline_orientation=True, lang='en', enable_mkldnn=False)"

# Copy application code
COPY . .

EXPOSE 8080

# Run entrypoint using PORT provided by Cloud Run
CMD ["python", "app.py"]
