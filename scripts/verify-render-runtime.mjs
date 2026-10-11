#!/usr/bin/env node
/**
 * Runtime smoke test for the media tools required by the cloud timeline compositor.
 * Generates a tiny synthetic MP4, burns an SRT caption, mixes audio, then probes output.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${(result.stderr || result.stdout || '').slice(-3500)}`);
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dir = await mkdtemp(join(tmpdir(), 'hendy-render-runtime-'));
try {
  const filters = run('ffmpeg', ['-hide_banner', '-filters']);
  for (const name of ['subtitles', 'overlay', 'amix', 'adelay', 'alimiter']) {
    assert(new RegExp(`\\b${name}\\b`).test(filters), `FFmpeg filter '${name}' is missing; rebuild worker image with libass and audio filters.`);
  }
  const encoders = run('ffmpeg', ['-hide_banner', '-encoders']);
  assert(/\blibx264\b/.test(encoders), 'FFmpeg libx264 encoder is missing.');
  run('ffprobe', ['-version']);

  const input = join(dir, 'input.mp4');
  const output = join(dir, 'render-smoke.mp4');
  const subtitle = join(dir, 'smoke.srt');
  const filterScript = join(dir, 'filter-complex.txt');
  await writeFile(subtitle, '1\n00:00:00,100 --> 00:00:00,800\nHendy Studio Pro smoke test\n', { mode: 0o600 });
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input,
  ]);

  const subPath = subtitle.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  const graph = [
    'color=c=black:s=320x240:r=24:d=1,format=rgba[canvas0]',
    '[0:v]trim=start=0:duration=1,setpts=PTS-STARTPTS+0/TB,fps=24,scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba[visual0]',
    "[canvas0][visual0]overlay=x=(W-w)/2+0:y=(H-h)/2+0:eof_action=pass:repeatlast=0:shortest=0:enable='between(t,0,1)'[canvas1]",
    `[canvas1]subtitles=filename='${subPath}':force_style='FontName=DejaVu Sans,FontSize=18,Outline=1,Alignment=2,MarginV=15'[videoout]`,
    '[0:a:0]atrim=start=0:duration=1,asetpts=PTS-STARTPTS,volume=0.8,adelay=0:all=1[a0]',
    '[a0]amix=inputs=1:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration=1[audioout]',
  ].join(';\n');
  await writeFile(filterScript, graph, { mode: 0o600 });
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input,
    '-filter_complex_script', filterScript, '-map', '[videoout]', '-map', '[audioout]',
    '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', output,
  ]);
  const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', output]);
  const metadata = JSON.parse(probe);
  const streamTypes = (metadata.streams || []).map(stream => stream.codec_type);
  assert(streamTypes.includes('video') && streamTypes.includes('audio'), 'Smoke output is missing its video or audio stream.');
  assert(Number(metadata.format?.duration) > 0.8, 'Smoke output duration is shorter than expected.');
  console.log('PASS: FFmpeg runtime supports libx264, overlay, subtitle burn-in/libass, amix, adelay, limiter, and audio/video MP4 output.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
