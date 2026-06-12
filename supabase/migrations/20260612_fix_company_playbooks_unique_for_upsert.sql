-- Corrective migration. The original company_playbooks migration created a
-- PARTIAL unique index (... where template_key is not null). Postgres cannot
-- satisfy ON CONFLICT (company_id, template_key) against a partial index
-- (error 42P10), which would make seedDefaultPlaybooks()/upsert fail in prod.
-- Caught by an owner-context end-to-end self-test before release.
--
-- Replace it with a FULL unique index: custom playbooks (template_key NULL)
-- remain multi-row because NULLs are distinct, while default templates stay
-- deduped by template_key. This is what the client upsert targets.
drop index if exists public.company_playbooks_default_uq;
create unique index if not exists company_playbooks_company_template_uq
  on public.company_playbooks (company_id, template_key);
