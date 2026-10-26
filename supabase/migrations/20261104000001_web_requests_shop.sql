-- 予約フォームの送信回数（いたずら対策）を店舗ごとに数える

set search_path = bar, public;

alter table web_requests add column if not exists shop_id uuid references shops (id) on delete cascade
  default '00000000-0000-4000-8000-000000000001';
update web_requests set shop_id = '00000000-0000-4000-8000-000000000001' where shop_id is null;
alter table web_requests alter column shop_id set not null;
create index if not exists web_requests_shop_idx on web_requests (shop_id, created_at desc);
