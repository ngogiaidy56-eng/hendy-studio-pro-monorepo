# Pipeline agent — Whisper transcription

This independent CLI worker creates `.srt` from a local audio/video file using `faster-whisper` on CPU by default. It is intentionally not exposed as a public network service; connect it to a secured queue consumer before enabling automated cloud jobs.

## Run locally

```bash
python -m venv .venv
# Linux/macOS
source .venv/bin/activate
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
python src/transcribe.py ./input.mp4 --language auto --model small --output ./output.srt
```

The first invocation downloads model weights and requires network access. Later runs may use a cached model. For a Docker one-off:

```bash
docker build -t hendy-transcriber .
docker run --rm -v "$PWD/media:/media" hendy-transcriber /media/input.mp4 --output /media/input.srt
```

Input is limited to 2 GiB and 12 hours. This agent writes to a local path, does not accept remote URLs, and does not upload media automatically. Do not mount secrets or the Docker socket into this container.
