CREATE SCHEMA IF NOT EXISTS meeting_cost;
CREATE TABLE IF NOT EXISTS meeting_cost.rate_catalog (
  id integer PRIMARY KEY CHECK (id = 1),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object')
);
CREATE TABLE IF NOT EXISTS meeting_cost.estimates (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL CHECK (report->>'status' = 'estimated')
);
CREATE INDEX IF NOT EXISTS estimates_created_at_idx ON meeting_cost.estimates (created_at DESC);
