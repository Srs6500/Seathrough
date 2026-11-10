-- Stripe subscription fields on billing_accounts.
-- Run after 010_billing.sql.
--
-- plan_source becomes 'promo' | 'stripe' (still nullable for free accounts).
-- Written only by the server (service role) — no new RLS write policies.

alter table public.billing_accounts
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text;

create unique index if not exists billing_accounts_stripe_customer_uidx
  on public.billing_accounts (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists billing_accounts_stripe_subscription_idx
  on public.billing_accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.billing_accounts.stripe_customer_id is
  'Stripe Customer id (cus_…). Set when the user opens Checkout.';
comment on column public.billing_accounts.stripe_subscription_id is
  'Active (or most recent) Stripe Subscription id (sub_…).';
comment on column public.billing_accounts.subscription_status is
  'Last known Stripe subscription.status (active, canceled, past_due, …).';
