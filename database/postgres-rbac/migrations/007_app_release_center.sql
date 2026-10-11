-- Application release center: metadata, signed artifacts and store-review workflow.
CREATE TABLE IF NOT EXISTS app_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug VARCHAR(80) NOT NULL DEFAULT 'hendy-studio-pro',
  product_name VARCHAR(160) NOT NULL DEFAULT 'Hendy Studio Pro',
  version VARCHAR(80) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable','beta','nightly')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','qa','ready','published','withdrawn')),
  release_notes TEXT NOT NULL DEFAULT '',
  minimum_os VARCHAR(120) NOT NULL DEFAULT '',
  is_security_update BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_slug, version, channel)
);
CREATE INDEX IF NOT EXISTS idx_app_releases_catalog ON app_releases(product_slug,status,channel,published_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_releases_created ON app_releases(created_at DESC);

CREATE TABLE IF NOT EXISTS app_release_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES app_releases(id) ON DELETE CASCADE,
  platform VARCHAR(24) NOT NULL CHECK (platform IN ('windows','macos','linux','android','ios','web')),
  architecture VARCHAR(24) NOT NULL DEFAULT 'universal' CHECK (architecture IN ('x86','x64','arm64','universal','web')),
  package_format VARCHAR(20) NOT NULL CHECK (package_format IN ('exe','msi','msix','msixbundle','appxbundle','dmg','pkg','appimage','deb','rpm','apk','aab','ipa','zip','pwa','other')),
  file_name VARCHAR(240) NOT NULL,
  content_type VARCHAR(160) NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2147483648),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-fA-F0-9]{64}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','deleting','deleted','failed')),
  download_count BIGINT NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, platform, architecture, package_format)
);
CREATE INDEX IF NOT EXISTS idx_release_artifacts_release_status ON app_release_artifacts(release_id,status);

CREATE TABLE IF NOT EXISTS app_store_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES app_releases(id) ON DELETE CASCADE,
  store VARCHAR(32) NOT NULL CHECK (store IN ('direct','microsoft_store','google_play','apple_app_store','github_releases')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','prepared','submitted','in_review','approved','rejected','live')),
  listing_url TEXT NOT NULL DEFAULT '',
  external_version VARCHAR(80) NOT NULL DEFAULT '',
  reviewer_notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(release_id,store)
);
CREATE INDEX IF NOT EXISTS idx_store_submissions_release ON app_store_submissions(release_id,store);

INSERT INTO permissions(action_code,module,description) VALUES
 ('release:manage','releases','Create, upload, review and publish application releases'),
 ('release:read','releases','Read internal application release metadata')
ON CONFLICT(action_code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='admin' AND p.action_code IN ('release:manage','release:read')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='developer' AND p.action_code='release:read'
ON CONFLICT DO NOTHING;
