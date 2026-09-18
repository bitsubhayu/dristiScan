FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PORT=8001

WORKDIR /app

# Install Python dependencies for Google Cloud Vision OCR microservice
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8001

# Run entrypoint using PORT provided by environment or default 8001
CMD ["python", "app.py"]
