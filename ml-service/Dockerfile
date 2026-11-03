# ML service / core engine. Gemini (Vertex AI, ADC) reads every resume; the
# only local model is MiniLM for embeddings, downloaded on first use into
# HF_HOME -- mount a volume there (see docker-compose.yml) so it is fetched
# once, not on every container start. (The local NER model is archived:
# archive/ner_model/README.md.)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models

WORKDIR /srv

# CPU-only torch first, so pip never pulls the multi-GB CUDA wheel.
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
