-- Mark asynchronous object deletion explicitly so quota accounting remains conservative across failures.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_check;
ALTER TABLE assets ADD CONSTRAINT assets_status_check
  CHECK (status IN ('pending','uploaded','failed','deleting','deleted'));
CREATE INDEX IF NOT EXISTS idx_assets_stale_cleanup
  ON assets(status, updated_at) WHERE status IN ('pending','deleting');
COMMENT ON COLUMN assets.status IS 'deleting assets remain quota-accounted until the object store confirms deletion.';
