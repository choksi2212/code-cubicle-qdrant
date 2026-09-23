FROM python:3.12-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

# Copy source
COPY app/ ./app/

# Render sets PORT (defaults 10000). Our Settings class reads `port` env var.
# Use shell form so we can substitute $PORT.
EXPOSE 10000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2"]
