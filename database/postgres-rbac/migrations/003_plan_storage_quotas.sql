-- Storage quotas live with each plan so the API can enforce limits atomically before issuing upload URLs.
UPDATE plans
SET features = features || CASE code
  WHEN 'free' THEN '{"maxStorageBytes":2147483648}'::jsonb
  WHEN 'creator' THEN '{"maxStorageBytes":53687091200}'::jsonb
  WHEN 'studio' THEN '{"maxStorageBytes":536870912000}'::jsonb
  ELSE '{}'::jsonb
END
WHERE code IN ('free', 'creator', 'studio');

COMMENT ON COLUMN assets.size_bytes IS 'Client-reported size verified against object-storage HEAD before status becomes uploaded; limited to 2 GiB per asset.';
