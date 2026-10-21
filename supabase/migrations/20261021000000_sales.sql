-- 売上・スタッフ・バック・証拠写真

set search_path = bar, public;

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- {"drink": %, "charge": %, "service": %, "perVisit": 円}
  back_rates jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

alter table customers add column if not exists staff_id uuid references staff (id) on delete set null;

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  reservation_id uuid references reservations (id) on delete set null,
  customer_id uuid references customers (id) on delete set null,
  staff_id uuid references staff (id) on delete set null,
  channel text not null check (channel in ('line', 'instagram', 'simulator', 'manual')),
  customer_name text,
  party_size integer not null check (party_size > 0),
  drink_amount integer not null check (drink_amount >= 0),
  charge_amount integer not null check (charge_amount >= 0),
  service_amount integer not null check (service_amount >= 0),
  note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_date_idx on sales (business_date);
create index if not exists sales_reservation_idx on sales (reservation_id);

create table if not exists sale_attachments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales (id) on delete cascade,
  file_name text not null,
  content_type text not null,
  size integer not null,
  -- Supabase Storage（bar-evidence バケット）内のパス
  storage_path text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists sale_attachments_sale_idx on sale_attachments (sale_id);

alter table staff enable row level security;
alter table sales enable row level security;
alter table sale_attachments enable row level security;

-- 証拠写真の保存先（非公開。サーバーが service_role で読み書きする）
insert into storage.buckets (id, name, public)
values ('bar-evidence', 'bar-evidence', false)
on conflict (id) do nothing;
