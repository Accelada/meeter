-- Run in the Neon SQL Editor connected to the intended branch.
SELECT employee_id, name, email, position, cost, currency, active
FROM meeting_cost.rate_catalog ORDER BY name, email;

-- Examples: select and execute only the statement you want.
INSERT INTO meeting_cost.rate_catalog (name, email, position, cost, currency)
VALUES ('Ana García', 'ana@example.com', 'Consultora', 65.50, 'EUR');

UPDATE meeting_cost.rate_catalog SET cost = 70, name = 'Ana García'
WHERE email = 'ana@example.com';

-- Deactivate to preserve the directory entry, or remove it completely.
UPDATE meeting_cost.rate_catalog SET active = false WHERE email = 'ana@example.com';
DELETE FROM meeting_cost.rate_catalog WHERE email = 'ana@example.com';

SELECT * FROM meeting_cost.settings;
SELECT * FROM meeting_cost.cost_centers;
SELECT * FROM meeting_cost.excluded_emails;
