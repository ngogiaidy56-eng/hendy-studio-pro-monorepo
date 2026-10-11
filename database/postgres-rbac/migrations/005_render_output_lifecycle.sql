-- Mark generated output deletion explicitly so quota accounting and object deletion can be retried safely.
ALTER TABLE render_jobs DROP CONSTRAINT IF EXISTS render_jobs_status_check;
ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_status_check
  CHECK (status IN ('queued','processing','completed','failed','cancelled','deleting','deleted'));
CREATE INDEX IF NOT EXISTS idx_render_jobs_user_storage
  ON render_jobs(user_id, status) WHERE status IN ('completed','deleting');
COMMENT ON COLUMN render_jobs.status IS 'deleting/deleted states represent explicit output lifecycle transitions; deleted outputs are not downloadable.';
