-- 複数の店舗：店舗ごとにオーナー・スタッフ・お客様・売上などを分ける。
-- これまでのデータはすべて「店舗1」（固定ID）のものにする。

set search_path = bar, public;

create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 予約フォームなど公開URLに使う短い名前（例: /s/<slug>/reserve）
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);
alter table shops enable row level security;

insert into shops (id, name, slug)
values ('00000000-0000-4000-8000-000000000001', '店舗1', 'shop1')
on conflict (id) do nothing;

-- 店舗ごとの設定（旧 shop_settings は1店舗用なので写して使う）
create table if not exists settings (
  shop_id uuid primary key references shops (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;
insert into settings (shop_id, data, updated_at)
select '00000000-0000-4000-8000-000000000001', data, updated_at from shop_settings where id = 1
on conflict (shop_id) do nothing;

-- 店舗ごとのGoogleカレンダー連携（旧 google_integration から写す）
create table if not exists google_integrations (
  shop_id uuid primary key references shops (id) on delete cascade,
  refresh_token_encrypted text not null,
  calendar_id text not null default 'primary',
  account_email text,
  updated_at timestamptz not null default now()
);
alter table google_integrations enable row level security;
insert into google_integrations (shop_id, refresh_token_encrypted, calendar_id, account_email, updated_at)
select '00000000-0000-4000-8000-000000000001', refresh_token_encrypted, calendar_id, account_email, updated_at
from google_integration where id = 1
on conflict (shop_id) do nothing;

-- 店舗ごとのSNS接続の秘密情報（LINE・Instagram）。アプリ側で暗号化して保存する
create table if not exists shop_secrets (
  shop_id uuid primary key references shops (id) on delete cascade,
  data_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table shop_secrets enable row level security;

-- 各表に店舗を付ける
alter table customers add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table messages add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table drafts add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table reservations add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table staff add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table sales add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table sale_attachments add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table audit_logs add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table menu_items add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table order_tables add column if not exists shop_id uuid references shops (id) on delete cascade;
alter table orders add column if not exists shop_id uuid references shops (id) on delete cascade;

update customers set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update messages set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update drafts set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update reservations set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update staff set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update sales set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update sale_attachments set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update audit_logs set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update menu_items set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update order_tables set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
update orders set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;

alter table customers alter column shop_id set not null;
alter table messages alter column shop_id set not null;
alter table drafts alter column shop_id set not null;
alter table reservations alter column shop_id set not null;
alter table staff alter column shop_id set not null;
alter table sales alter column shop_id set not null;
alter table sale_attachments alter column shop_id set not null;
alter table audit_logs alter column shop_id set not null;
alter table menu_items alter column shop_id set not null;
alter table order_tables alter column shop_id set not null;
alter table orders alter column shop_id set not null;

-- 店舗を指定しない古い版のアプリからの追加は店舗1に入れる（新しい版は必ず店舗を指定する）
alter table customers alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table messages alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table drafts alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table reservations alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table staff alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table sales alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table sale_attachments alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table audit_logs alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table menu_items alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table order_tables alter column shop_id set default '00000000-0000-4000-8000-000000000001';
alter table orders alter column shop_id set default '00000000-0000-4000-8000-000000000001';

create index if not exists customers_shop_idx on customers (shop_id, created_at desc);
create index if not exists messages_shop_idx on messages (shop_id, created_at desc);
create index if not exists reservations_shop_time_idx on reservations (shop_id, start_at);
create index if not exists staff_shop_idx on staff (shop_id);
create index if not exists sales_shop_date_idx on sales (shop_id, business_date);
create index if not exists audit_logs_shop_idx on audit_logs (shop_id, created_at desc);
create index if not exists menu_items_shop_idx on menu_items (shop_id);
create index if not exists order_tables_shop_idx on order_tables (shop_id);
create index if not exists orders_shop_idx on orders (shop_id, created_at desc);

-- スタッフ表にオーナーも入れる（role で区別）
alter table staff add column if not exists role text not null default 'staff' check (role in ('owner', 'staff'));

-- 同じSNSのお客様・電話番号でも、店舗が違えば別のお客様
create unique index if not exists customers_shop_channel_external_key on customers (shop_id, channel, external_id);

grant all on shops, settings, google_integrations, shop_secrets to service_role;
