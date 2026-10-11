CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','pending')),
  tier VARCHAR(30) NOT NULL DEFAULT 'free' CHECK(tier IN ('free','creator','studio','enterprise')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), action_code VARCHAR(120) NOT NULL UNIQUE,
  module VARCHAR(80) NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL, assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,role_id)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id,permission_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(160) NOT NULL,
  old_data JSONB, new_data JSONB, ip_address INET, user_agent VARCHAR(500), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents>=0), currency CHAR(3) NOT NULL DEFAULT 'USD',
  billing_interval VARCHAR(20) NOT NULL DEFAULT 'month' CHECK(billing_interval IN ('month','year','one_time')),
  features JSONB NOT NULL DEFAULT '{}'::jsonb, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id), status VARCHAR(24) NOT NULL DEFAULT 'trialing' CHECK(status IN ('trialing','active','past_due','cancelled','expired')),
  provider VARCHAR(40), provider_subscription_id VARCHAR(200), period_start TIMESTAMPTZ, period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(provider,provider_subscription_id)
);
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(40) NOT NULL, provider_event_id VARCHAR(200) NOT NULL, event_type VARCHAR(120) NOT NULL,
  amount_cents INTEGER CHECK(amount_cents IS NULL OR amount_cents>=0), currency CHAR(3), status VARCHAR(30) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id,status);
INSERT INTO plans(code,name,price_cents,currency,billing_interval,features) VALUES
 ('free','Free',0,'USD','month','{"maxProjects":3,"maxRenderMinutes":30}'::jsonb),
 ('creator','Creator',990,'USD','month','{"maxProjects":50,"maxRenderMinutes":600}'::jsonb),
 ('studio','Studio',2990,'USD','month','{"maxProjects":500,"maxRenderMinutes":3000}'::jsonb)
ON CONFLICT(code) DO NOTHING;
