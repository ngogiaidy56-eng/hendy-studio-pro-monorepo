-- Client-probed duration helps the editor place clips; the render worker still probes actual media before rendering.
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION
  CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 43200));
