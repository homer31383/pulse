-- Post Pulse: workflow docs can keep a conversation, not just one answer
-- messages holds the saved slice of the chat ([{role, content}] in order,
-- user/assistant alternating). prompt stays the first user message of the
-- slice (what Re-run asks again) and content the last assistant answer, so
-- single-answer docs and existing rows are unchanged (messages = []).
-- Additive, idempotent; saving a multi-turn slice is refused with a clear
-- message until this is applied.

alter table pp_workflow_docs add column if not exists messages jsonb not null default '[]'::jsonb;
