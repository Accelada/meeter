-- Preserve the original JSON as a migration snapshot, never used for live reads.
ALTER TABLE meeting_cost.rate_catalog RENAME TO rate_catalog_legacy;

CREATE TABLE meeting_cost.settings (
  id integer PRIMARY KEY CHECK (id = 1),
  currency text NOT NULL UNIQUE CHECK (currency ~ '^[A-Z]{3}$'),
  default_hourly_cost numeric NOT NULL CHECK (default_hourly_cost >= 0 AND default_hourly_cost NOT IN ('NaN'::numeric, 'Infinity'::numeric))
);
INSERT INTO meeting_cost.settings
SELECT 1, config->>'currency', (config->>'defaultHourlyRate')::numeric FROM meeting_cost.rate_catalog_legacy;

CREATE TABLE meeting_cost.rate_catalog (
  employee_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  name text NOT NULL DEFAULT '',
  position text NOT NULL DEFAULT '',
  cost numeric NOT NULL CHECK (cost >= 0 AND cost NOT IN ('NaN'::numeric, 'Infinity'::numeric)),
  currency text NOT NULL REFERENCES meeting_cost.settings(currency) ON UPDATE CASCADE,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO meeting_cost.rate_catalog (email, name, position, cost, currency)
SELECT lower(trim(employee->>'email')), coalesce(employee->>'name', employee->>'email'),
       coalesce(employee->>'position', ''), (employee->>'hourlyRate')::numeric, config->>'currency'
FROM meeting_cost.rate_catalog_legacy CROSS JOIN LATERAL jsonb_array_elements(config->'employees') employee;

CREATE TABLE meeting_cost.cost_centers (id text PRIMARY KEY, name text NOT NULL);
INSERT INTO meeting_cost.cost_centers
SELECT center->>'id', center->>'name' FROM meeting_cost.rate_catalog_legacy CROSS JOIN LATERAL jsonb_array_elements(config->'costCenters') center;
CREATE TABLE meeting_cost.excluded_emails (email text PRIMARY KEY CHECK (email = lower(trim(email))));
INSERT INTO meeting_cost.excluded_emails
SELECT DISTINCT lower(trim(email)) FROM meeting_cost.rate_catalog_legacy CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(config->'excludedEmails','[]'::jsonb)) email;

CREATE INDEX estimates_outlook_item_id_idx ON meeting_cost.estimates ((report->>'outlookItemId')) WHERE report ? 'outlookItemId';
