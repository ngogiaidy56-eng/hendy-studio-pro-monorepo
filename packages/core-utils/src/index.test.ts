import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderManifest, formatSrtTimestamp, isSafeObjectKey, validateTimelineDocument } from './index.js';

test('object keys reject traversal, absolute paths and backslashes', () => {
  assert.equal(isSafeObjectKey('users/u1/assets/clip.mp4'), true);
  assert.equal(isSafeObjectKey('../secret'), false);
  assert.equal(isSafeObjectKey('/etc/passwd'), false);
  assert.equal(isSafeObjectKey('users/u1/../secret'), false);
  assert.equal(isSafeObjectKey('users\\u1\\clip.mp4'), false);
});

test('timeline document validates bounded dimensions and clip timing', () => {
  const timeline = { version: 1, fps: 30, resolution: { width: 1920, height: 1080 }, tracks: [
    { id: 'v1', type: 'video', name: 'Video 1', clips: [{ id: 'c1', assetKey: 'users/u1/assets/a.mp4', start: 0, duration: 4, sourceIn: 0, sourceOut: 4 }] },
  ] };
  assert.equal(validateTimelineDocument(timeline), true);
  assert.equal(validateTimelineDocument({ ...timeline, resolution: { width: 99999, height: 1080 } }), false);
  assert.equal(validateTimelineDocument({ ...timeline, resolution: { width: 1921, height: 1080 } }), false);
  assert.equal(validateTimelineDocument({ ...timeline, fps: 17 }), false);
  assert.equal(validateTimelineDocument({ ...timeline, tracks: [{ ...timeline.tracks[0], clips: [{ ...timeline.tracks[0].clips[0], duration: Number.MAX_SAFE_INTEGER }] }] }), false);
  assert.doesNotThrow(() => buildRenderManifest('project-1', timeline as never));
});

test('SRT timestamps format to milliseconds', () => {
  assert.equal(formatSrtTimestamp(65.007), '00:01:05,007');
  assert.throws(() => formatSrtTimestamp(-1), RangeError);
  assert.throws(() => formatSrtTimestamp(Number.MAX_VALUE), RangeError);
});
