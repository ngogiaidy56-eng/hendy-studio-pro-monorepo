FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --create-home --uid 10001 agent
WORKDIR /opt/hendy-agent
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
RUN chown -R agent:agent /opt/hendy-agent
USER agent
ENTRYPOINT ["python", "src/transcribe.py"]
