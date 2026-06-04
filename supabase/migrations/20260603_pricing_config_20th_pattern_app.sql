-- ═══════════════════════════════════════════════════════════════
-- 2026-06-03 Pricing Config (20th pattern application)
-- ─────────────────────────────────────────────────────────────
-- Audit (C-1, 4 markers): constants/pricing.ts hardcodes 4 company
-- tiers + 3 civilian plans + 5 add-ons. Every price tweak required
-- a full code deploy. Pricing is REFERENCE DATA (same across all
-- tenants), so the pattern app shape differs from the prior 19:
--   • No RLS-by-company — public-readable (anon allowed because
--     pricing is shown on the public landing page before login).
--   • No clearXCache in complete-logout (data isn't tenant-scoped).
--   • Service caches the fetched config in memory + localStorage
--     for sub-second first paint and offline survivability.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.plans (
  id                    text primary key,
  kind                  text not null check (kind in ('unified','individual','addon')),
  name                  text not null,
  name_ar               text,
  description           text,
  color                 text,
  monthly_price         numeric,
  annual_price          numeric,
  annual_monthly        numeric,
  max_employees         integer,
  max_zones             integer,
  extra_employee_price  numeric,
  features              jsonb not null default '[]'::jsonb,
  popular               boolean not null default false,
  sort_order            integer not null default 0,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists plans_kind_sort_idx on public.plans(kind, sort_order)
  where active = true;

alter table public.plans enable row level security;

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans
  for select using (active = true);

create or replace function public.list_plans(p_kind text default null)
returns table (
  id text, kind text, name text, name_ar text, description text, color text,
  monthly_price numeric, annual_price numeric, annual_monthly numeric,
  max_employees integer, max_zones integer, extra_employee_price numeric,
  features jsonb, popular boolean, sort_order integer
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id, p.kind, p.name, p.name_ar, p.description, p.color,
         p.monthly_price, p.annual_price, p.annual_monthly,
         p.max_employees, p.max_zones, p.extra_employee_price,
         p.features, p.popular, p.sort_order
  from public.plans p
  where p.active = true
    and (p_kind is null or p.kind = p_kind)
  order by p.kind, p.sort_order, p.id;
$$;
revoke execute on function public.list_plans(text) from public, anon;
grant  execute on function public.list_plans(text) to authenticated, anon;

-- Seed 4 unified + 3 individual + 5 addon plans (mirrors constants/pricing.ts).
-- on conflict updates so re-running the migration syncs price changes idempotently.
insert into public.plans (id, kind, name, name_ar, description, color,
                          max_employees, max_zones, monthly_price, annual_price, annual_monthly,
                          extra_employee_price, features, popular, sort_order)
values
  ('starter',    'unified', 'Starter',    'ستارتر',   'For small teams 5-25 employees',     '#00C8E0',  25,  3,  149,  1428,  119, 8,
    '["SOS + GPS + Check-in","Up to 25 employees","Up to 3 zones","Basic Reports","Email Support","14-day free trial"]'::jsonb, false, 1),
  ('growth',     'unified', 'Growth',     'قروث',    'For growing teams 26-100 employees',  '#7B5EFF', 100, 10,  349,  3348,  279, 6,
    '["All Starter features","Up to 100 employees","Up to 10 zones","Advanced Reports","Priority Support","Audit Log Export"]'::jsonb, true, 2),
  ('business',   'unified', 'Business',   'بزنس',    'For 101-500 employees',               '#FF9500', 500, 50,  799,  7668,  639, 4,
    '["All Growth features","Up to 500 employees","Up to 50 zones","API Access","SAML SSO","SLA 99.9%"]'::jsonb, false, 3),
  ('enterprise', 'unified', 'Enterprise', 'إنتربرايز', '500+ employees, custom contracts',   '#FF2D55',  -1, -1,   -1,    -1,   -1, 0,
    '["All Business features","Unlimited employees","Unlimited zones","Custom integrations","24/7 phone support","Dedicated CSM"]'::jsonb, false, 4)
on conflict (id) do update set
  name = excluded.name, name_ar = excluded.name_ar, description = excluded.description,
  color = excluded.color, max_employees = excluded.max_employees, max_zones = excluded.max_zones,
  monthly_price = excluded.monthly_price, annual_price = excluded.annual_price,
  annual_monthly = excluded.annual_monthly, extra_employee_price = excluded.extra_employee_price,
  features = excluded.features, popular = excluded.popular, sort_order = excluded.sort_order,
  updated_at = now();

insert into public.plans (id, kind, name, name_ar, description, color,
                          monthly_price, annual_price,
                          max_employees, max_zones, features, sort_order)
values
  ('individual_free',  'individual', 'Free',  'مجاني',  'Free tier — 3 SOS/day, 1 contact', '#6E7681',  0,   0, null, null,
    '["3 SOS triggers per day","Basic GPS","1 Emergency Contact","Limited Medical ID"]'::jsonb, 1),
  ('individual_basic', 'individual', 'Basic', 'بيسك',   'Unlimited SOS + Family Circle 3', '#00C8E0',  7,  59, null, null,
    '["Unlimited SOS","Advanced GPS","Full Medical ID","Family Circle (3 people)","Fall Detection","Per-incident PDF reports","Email + SMS Support"]'::jsonb, 2),
  ('individual_elite', 'individual', 'Elite', 'إليت',   'AI calls + Walk-me + Heartbeat',   '#7B5EFF', 14, 119, null, null,
    '["Everything in Basic","Family Circle (5 people)","Safe Walk + Heartbeat","Voice-bridge to contacts","AI Voice Assistant on SOS","Advanced Stealth + Duress Code","Monthly summary email","Priority 24/7 Support"]'::jsonb, 3),
  ('addon_extra_reports',  'addon', 'Extra PDF Reports',  null, '+50 reports/month',          null, 15, null, null, null, '[]'::jsonb, 1),
  ('addon_twilio_sms',     'addon', 'SMS Alerts (Twilio)', null, '1,000 SMS/month',            null, 19, null, null, null, '[]'::jsonb, 2),
  ('addon_extra_zones',    'addon', 'Extra Zones Pack',    null, '+5 zones',                   null, 29, null, null, null, '[]'::jsonb, 3),
  ('addon_advanced_gps',   'addon', 'Advanced GPS',        null, 'Update every 30 seconds',    null, 39, null, null, null, '[]'::jsonb, 4),
  ('addon_custom_branding','addon', 'Custom Branding',     null, 'Company logo in reports',    null, 49, null, null, null, '[]'::jsonb, 5)
on conflict (id) do update set
  name = excluded.name, description = excluded.description,
  monthly_price = excluded.monthly_price, annual_price = excluded.annual_price,
  features = excluded.features, sort_order = excluded.sort_order, updated_at = now();
