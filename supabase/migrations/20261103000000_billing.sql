-- 月額の支払い（Stripe）。お店ごとの契約の状態

set search_path = bar, public;

alter table shops add column if not exists billing_status text not null default 'trialing'
  check (billing_status in ('trialing', 'active', 'past_due', 'canceled'));
-- 無料期間の終わり（登録時に決める。null は期限なし）
alter table shops add column if not exists trial_ends_at timestamptz;
-- 支払いが不要なお店（店舗1・運営が決めたお店）
alter table shops add column if not exists billing_exempt boolean not null default false;
alter table shops add column if not exists stripe_customer_id text;
alter table shops add column if not exists stripe_subscription_id text unique;
alter table shops add column if not exists current_period_end timestamptz;

update shops set billing_exempt = true where id = '00000000-0000-4000-8000-000000000001';
