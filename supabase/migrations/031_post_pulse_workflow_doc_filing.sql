-- Post Pulse: file a workflow doc under more than one department
-- department_id stays the primary filing (it anchors the doc's URL);
-- also_department_ids lists any additional departments the doc should
-- appear under. Reclassifying = changing department_id; "it belongs in
-- both" = adding to also_department_ids. Additive, idempotent; the code
-- degrades gracefully (primary-only) until this is applied.

alter table pp_workflow_docs add column if not exists also_department_ids uuid[] not null default '{}';

create index if not exists idx_pp_workflow_docs_also_departments on pp_workflow_docs using gin (also_department_ids);
