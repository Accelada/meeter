-- Legacy tables remain intact for rollback. Only Demo receives the old data.
CREATE SCHEMA meeter;
CREATE TABLE meeter.companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO meeter.companies(id,slug,name) VALUES ('00000000-0000-4000-8000-000000000001','demo','Demo');
CREATE TABLE meeter.members (
 company_id uuid NOT NULL REFERENCES meeter.companies ON DELETE CASCADE,
 email text NOT NULL CHECK(email=lower(trim(email))), role text NOT NULL CHECK(role IN ('admin','employee')),
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(company_id,email)
);
CREATE TABLE meeter.device_sessions (
 token_hash text PRIMARY KEY, company_id uuid NOT NULL, email text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,email) REFERENCES meeter.members(company_id,email) ON DELETE CASCADE
);
CREATE INDEX device_sessions_expiry ON meeter.device_sessions(expires_at);
CREATE TABLE meeter.settings (
 company_id uuid NOT NULL DEFAULT current_setting('meeter.company_id')::uuid REFERENCES meeter.companies,
 id integer NOT NULL DEFAULT 1 CHECK(id=1), currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 default_hourly_cost numeric NOT NULL CHECK(default_hourly_cost>=0 AND default_hourly_cost NOT IN ('NaN'::numeric,'Infinity'::numeric)),
 PRIMARY KEY(company_id,id), UNIQUE(company_id,currency)
);
CREATE TABLE meeter.rate_catalog (
 company_id uuid NOT NULL DEFAULT current_setting('meeter.company_id')::uuid REFERENCES meeter.companies,
 employee_id bigint GENERATED ALWAYS AS IDENTITY, email text NOT NULL CHECK(email=lower(trim(email))),
 name text NOT NULL DEFAULT '', position text NOT NULL DEFAULT '',
 cost numeric NOT NULL CHECK(cost>=0 AND cost NOT IN ('NaN'::numeric,'Infinity'::numeric)), currency text NOT NULL,
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(company_id,email),
 FOREIGN KEY(company_id,currency) REFERENCES meeter.settings(company_id,currency) ON UPDATE CASCADE
);
CREATE TABLE meeter.cost_centers (
 company_id uuid NOT NULL DEFAULT current_setting('meeter.company_id')::uuid REFERENCES meeter.companies,
 id text NOT NULL, name text NOT NULL, PRIMARY KEY(company_id,id)
);
CREATE TABLE meeter.excluded_emails (
 company_id uuid NOT NULL DEFAULT current_setting('meeter.company_id')::uuid REFERENCES meeter.companies,
 email text NOT NULL, PRIMARY KEY(company_id,email)
);
CREATE TABLE meeter.estimates (
 company_id uuid NOT NULL DEFAULT current_setting('meeter.company_id')::uuid REFERENCES meeter.companies,
 id uuid NOT NULL, owner_email text NOT NULL DEFAULT current_setting('meeter.email'),
 created_at timestamptz NOT NULL DEFAULT now(), report jsonb NOT NULL, PRIMARY KEY(company_id,id)
);
CREATE INDEX tenant_meetings_item ON meeter.estimates(company_id,(report->>'outlookItemId'));
CREATE INDEX tenant_meetings_owner ON meeter.estimates(company_id,owner_email,created_at DESC);
INSERT INTO meeter.settings SELECT '00000000-0000-4000-8000-000000000001',id,currency,default_hourly_cost FROM meeting_cost.settings;
INSERT INTO meeter.rate_catalog(company_id,email,name,position,cost,currency,active)
 SELECT '00000000-0000-4000-8000-000000000001',email,name,position,cost,currency,active FROM meeting_cost.rate_catalog;
INSERT INTO meeter.cost_centers SELECT '00000000-0000-4000-8000-000000000001',id,name FROM meeting_cost.cost_centers;
INSERT INTO meeter.excluded_emails SELECT '00000000-0000-4000-8000-000000000001',email FROM meeting_cost.excluded_emails;
INSERT INTO meeter.estimates(company_id,id,owner_email,created_at,report)
 SELECT '00000000-0000-4000-8000-000000000001',id,lower(coalesce(report->>'organizerEmail','legacy@demo.invalid')),created_at,report FROM meeting_cost.estimates;
-- Requests use a non-owner role: RLS is effective even when the pool connects as the owner.
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='meeter_tenant') THEN CREATE ROLE meeter_tenant NOLOGIN NOBYPASSRLS; END IF; END $$;
GRANT meeter_tenant TO CURRENT_USER;
GRANT USAGE ON SCHEMA meeter TO meeter_tenant;
GRANT SELECT,INSERT,UPDATE,DELETE ON meeter.settings,meeter.rate_catalog,meeter.cost_centers,meeter.excluded_emails,meeter.estimates TO meeter_tenant;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA meeter TO meeter_tenant;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['settings','rate_catalog','cost_centers','excluded_emails'] LOOP
 EXECUTE format('ALTER TABLE meeter.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE meeter.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_read ON meeter.%I FOR SELECT TO meeter_tenant USING(company_id=current_setting(''meeter.company_id'')::uuid)',t);
 EXECUTE format('CREATE POLICY tenant_write ON meeter.%I FOR ALL TO meeter_tenant USING(company_id=current_setting(''meeter.company_id'')::uuid AND current_setting(''meeter.admin'')=''true'') WITH CHECK(company_id=current_setting(''meeter.company_id'')::uuid AND current_setting(''meeter.admin'')=''true'')',t);
 END LOOP;
END $$;
ALTER TABLE meeter.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeter.estimates FORCE ROW LEVEL SECURITY;
CREATE POLICY own_meetings ON meeter.estimates TO meeter_tenant
 USING(company_id=current_setting('meeter.company_id')::uuid AND (owner_email=current_setting('meeter.email') OR current_setting('meeter.admin')='true'))
 WITH CHECK(company_id=current_setting('meeter.company_id')::uuid AND (owner_email=current_setting('meeter.email') OR current_setting('meeter.admin')='true'));
