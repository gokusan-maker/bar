-- バー予約アプリ 初期スキーマ
-- サーバー（service_role キー）からのみアクセスする。RLSを有効にしてポリシーは作らない。
-- 1つのSupabaseプロジェクトに複数のアプリを同居させるため、表はすべて bar スキーマに置く。

create schema if not exists bar;

set search_path = bar, public;

create table if not exists shop_settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists google_integration (
  id smallint primary key default 1 check (id = 1),
  -- アプリ側で AES-256-GCM 暗号化したリフレッシュトークン
  refresh_token_encrypted text not null,
  calendar_id text not null default 'primary',
  account_email text,
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('line', 'instagram', 'simulator', 'manual')),
  external_id text,
  display_name text,
  name text,
  note text,
  created_at timestamptz not null default now(),
  unique (channel, external_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  text text not null,
  extraction jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists messages_customer_created_idx on messages (customer_id, created_at);
create index if not exists messages_created_idx on messages (created_at desc);

create table if not exists drafts (
  customer_id uuid primary key references customers (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  party_size integer not null check (party_size > 0),
  name text not null,
  notes text,
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'rejected', 'visited', 'no_show')),
  channel text not null,
  google_event_id text,
  reminder_sent_at timestamptz,
  -- 同時登録時の先着判定に使うので、トランザクション開始時刻ではなく実時刻を入れる
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists reservations_time_idx on reservations (start_at, end_at);
create index if not exists reservations_customer_idx on reservations (customer_id, start_at);

alter table shop_settings enable row level security;
alter table google_integration enable row level security;
alter table customers enable row level security;
alter table messages enable row level security;
alter table drafts enable row level security;
alter table reservations enable row level security;
