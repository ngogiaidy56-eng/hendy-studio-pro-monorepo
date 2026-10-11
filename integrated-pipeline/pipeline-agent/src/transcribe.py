#!/usr/bin/env python3
"""Local CPU Whisper transcription utility. This is an offline agent, not an HTTP service."""
from __future__ import annotations
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
MAX_DURATION_SECONDS = 12 * 60 * 60


def srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, rem = divmod(milliseconds, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio/video to an SRT subtitle file.")
    parser.add_argument("input", type=Path, help="Local video/audio input file")
    parser.add_argument("--output", type=Path, help="Output SRT path (default: input basename + .srt)")
    parser.add_argument("--model", default=os.getenv("WHISPER_MODEL", "small"), choices=["tiny", "base", "small", "medium", "large-v3"])
    parser.add_argument("--language", default=os.getenv("WHISPER_LANGUAGE", "auto"), help="Language code, e.g. en, ja, ko; 'auto' detects")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    args = parser.parse_args()

    source = args.input.expanduser().resolve()
    if not source.is_file():
        parser.error(f"input does not exist or is not a file: {source}")
    size = source.stat().st_size
    if size <= 0 or size > MAX_MEDIA_BYTES:
        parser.error("input size must be between 1 byte and 2 GiB")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("Missing dependency. Install with: pip install -r requirements.txt", file=sys.stderr)
        return 2

    output = (args.output or source.with_suffix(".srt")).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    print(f"Loading Whisper model '{args.model}' on {args.device}…", file=sys.stderr)
    model = WhisperModel(args.model, device=args.device, compute_type="int8" if args.device == "cpu" else "float16")
    language = None if args.language.lower() == "auto" else args.language
    segments, info = model.transcribe(str(source), language=language, vad_filter=True, beam_size=5)

    rendered: list[str] = []
    transcript: list[dict[str, Any]] = []
    for index, segment in enumerate(segments, start=1):
        if segment.end > MAX_DURATION_SECONDS:
            raise ValueError("media duration exceeds the 12-hour safety limit")
        text = " ".join(segment.text.split()).strip()
        if not text:
            continue
        rendered.append(f"{len(rendered) + 1}\n{srt_time(segment.start)} --> {srt_time(segment.end)}\n{text}")
        transcript.append({"start": round(segment.start, 3), "end": round(segment.end, 3), "text": text})

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent, prefix=".srt-", suffix=".tmp", delete=False) as temp:
        temp.write("\n\n".join(rendered) + ("\n" if rendered else ""))
        temp_path = Path(temp.name)
    try:
        temp_path.replace(output)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    metadata = {"source": source.name, "output": str(output), "language": info.language, "languageProbability": round(info.language_probability, 4), "segments": len(rendered)}
    print(json.dumps(metadata, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Transcription failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
