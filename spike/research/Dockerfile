# Spike (appshellhq/appshell#102): the research group's app, as they would ship it.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NICEGUI_STORAGE_PATH=/tmp/nicegui

RUN useradd --create-home --uid 10001 app
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
USER app

CMD ["python", "main.py"]
