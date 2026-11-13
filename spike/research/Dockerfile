# Spike (appshellhq/appshell#102): the research group's app, as they would ship it.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NICEGUI_STORAGE_PATH=/tmp/nicegui

RUN useradd --create-home --uid 10001 app
WORKDIR /app

# The version the group runs. 4.0.0 came out on 4 November 2026: build with it to try the bridge there.
ARG NICEGUI_VERSION=3.19.0
RUN pip install --no-cache-dir nicegui==${NICEGUI_VERSION}

COPY . .
USER app

CMD ["python", "main.py"]
