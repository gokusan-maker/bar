-- QRコード・URLからのお酒の注文（メニュー・席・注文）

set search_path = bar, public;

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  price integer not null check (price >= 0),
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists order_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- QRコードのURLに入る推測できない文字列
  token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references order_tables (id) on delete cascade,
  table_name text not null,
  -- [{menuItemId, name, price, qty}]（注文時点の名前と値段）
  lines jsonb not null,
  total integer not null check (total >= 0),
  note text,
  status text not null default 'new' check (status in ('new', 'served', 'cancelled')),
  sale_id uuid references sales (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists orders_table_idx on orders (table_id, created_at desc);

alter table menu_items enable row level security;
alter table order_tables enable row level security;
alter table orders enable row level security;

grant all on menu_items, order_tables, orders to service_role;
