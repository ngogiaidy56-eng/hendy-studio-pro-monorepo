import { SYSTEM_CONFIG } from './system-config.generated.js';
export { SYSTEM_CONFIG };
export type SystemConfig = typeof SYSTEM_CONFIG;

export type UserStatus = 'active' | 'suspended' | 'pending';
export type UserTier = 'free' | 'creator' | 'studio' | 'enterprise';
export type TimelineTrackType = 'video' | 'audio' | 'subtitle' | 'overlay';
export interface TimelineClip {
  id: string;
  assetKey: string;
  start: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  volume?: number;
  transform?: { x: number; y: number; scale: number; rotation: number };
}
export interface TimelineTrack {
  id: string;
  type: TimelineTrackType;
  name: string;
  muted?: boolean;
  locked?: boolean;
  clips: TimelineClip[];
}
export interface TimelineDocument {
  version: 1;
  fps: 24 | 25 | 30 | 50 | 60;
  resolution: { width: number; height: number };
  tracks: TimelineTrack[];
}
export interface RenderManifest {
  schemaVersion: 1;
  projectId: string;
  output: { container: 'mp4'; videoCodec: 'h264'; audioCodec: 'aac'; width: number; height: number; fps: number };
  tracks: TimelineTrack[];
}

export const PERMISSIONS = [
  'users:read', 'users:manage', 'roles:manage', 'audit:read', 'config:manage',
  'projects:read:any', 'subscriptions:read', 'release:manage', 'release:read',
] as const;
export type PermissionCode = typeof PERMISSIONS[number];

export function isSafeObjectKey(key: string): boolean {
  return key.length > 0 && key.length <= 500 && !key.startsWith('/')
    && !key.includes('\\') && key.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}

export function validateTimelineDocument(value: unknown): value is TimelineDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<TimelineDocument>;
  const fpsValues = [24, 25, 30, 50, 60];
  if (doc.version !== 1 || !fpsValues.includes(Number(doc.fps))) return false;
  if (!doc.resolution || !Number.isInteger(doc.resolution.width) || !Number.isInteger(doc.resolution.height)) return false;
  // H.264 4:2:0 output requires even dimensions; reject invalid output settings before FFmpeg runs.
  if (doc.resolution.width < 320 || doc.resolution.width > 3840 || doc.resolution.width % 2 !== 0
    || doc.resolution.height < 240 || doc.resolution.height > 2160 || doc.resolution.height % 2 !== 0) return false;
  if (!Array.isArray(doc.tracks) || doc.tracks.length > 64) return false;
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  let totalClips = 0;
  for (const track of doc.tracks) {
    if (!track || typeof track.id !== 'string' || !track.id || track.id.length > 120 || trackIds.has(track.id)) return false;
    if (!['video', 'audio', 'subtitle', 'overlay'].includes(track.type) || !Array.isArray(track.clips)) return false;
    trackIds.add(track.id);
    for (const clip of track.clips) {
      totalClips += 1;
      if (totalClips > SYSTEM_CONFIG.media.maxClipsPerRender) return false;
      if (!clip || typeof clip.id !== 'string' || !clip.id || clipIds.has(clip.id)) return false;
      if (typeof clip.assetKey !== 'string' || !isSafeObjectKey(clip.assetKey)) return false;
      if (![clip.start, clip.duration, clip.sourceIn, clip.sourceOut].every(n => Number.isFinite(n) && n >= 0)) return false;
      // Keep timeline arithmetic bounded to avoid abusive manifests and unreasonably long renders.
      if (clip.start > SYSTEM_CONFIG.media.maxTimelineSeconds || clip.start + clip.duration > SYSTEM_CONFIG.media.maxTimelineSeconds || clip.duration <= 0 || clip.duration > SYSTEM_CONFIG.media.maxTimelineSeconds
        || clip.sourceIn > SYSTEM_CONFIG.media.maxTimelineSeconds || clip.sourceOut > SYSTEM_CONFIG.media.maxTimelineSeconds || clip.sourceOut <= clip.sourceIn) return false;
      if (Math.abs((clip.sourceOut - clip.sourceIn) - clip.duration) > 0.06) return false;
      if (clip.volume !== undefined && (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 4)) return false;
      if (clip.transform !== undefined) {
        const transform = clip.transform;
        if (![transform.x, transform.y, transform.scale, transform.rotation].every(Number.isFinite)
          || Math.abs(transform.x) > 10000 || Math.abs(transform.y) > 10000
          || transform.scale < 0.05 || transform.scale > 3 || Math.abs(transform.rotation) > 360) return false;
      }
      clipIds.add(clip.id);
    }
  }
  return true;
}

export function formatSrtTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 7 * 24 * 60 * 60) throw new RangeError('Timestamp must be finite and within seven days');
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function buildRenderManifest(projectId: string, timeline: TimelineDocument): RenderManifest {
  if (!projectId.trim() || projectId.length > 120) throw new Error('Invalid project ID');
  if (!validateTimelineDocument(timeline)) throw new Error('Invalid timeline document');
  return {
    schemaVersion: 1,
    projectId,
    output: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: timeline.resolution.width, height: timeline.resolution.height, fps: timeline.fps },
    tracks: timeline.tracks,
  };
}
