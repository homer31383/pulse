-- Post Pulse: department cross-referencing
-- Lets a department point at related departments without duplicating
-- tool rows across them. Addresses the recurring cross-cutting-department
-- problem (flagged as a known simplification when Generative Media
-- Models & Platforms was created, now hit again with Concept & Image
-- Generation). Deliberately lightweight — an array of department ids,
-- not a join table — since the need is "link and reference," not
-- "share ownership" of tool rows.

alter table pp_departments add column if not exists related_department_ids uuid[] not null default '{}';

create index if not exists idx_pp_departments_related on pp_departments using gin (related_department_ids);
