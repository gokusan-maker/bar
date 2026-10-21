-- 予約フォーム（web）からの受付

alter table customers drop constraint if exists customers_channel_check;
alter table customers add constraint customers_channel_check
  check (channel in ('line', 'instagram', 'web', 'simulator', 'manual'));

alter table sales drop constraint if exists sales_channel_check;
alter table sales add constraint sales_channel_check
  check (channel in ('line', 'instagram', 'web', 'simulator', 'manual'));

-- 予約フォームの送信回数（いたずら・大量送信対策）
create table if not exists web_requests (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists web_requests_ip_idx on web_requests (ip, created_at desc);
alter table web_requests enable row level security;

-- 毎日の削除処理で、古い送信記録も消す（関数を置き換え）
create or replace function purge_personal_data(cutoff timestamptz)
returns json
language plpgsql
as $$
declare
  n_messages int;
  n_reservations int;
  n_sales int;
  n_customers int;
begin
  delete from messages where created_at < cutoff;
  get diagnostics n_messages = row_count;

  delete from drafts where updated_at < cutoff;

  update reservations set name = '（削除済み）', notes = null
  where end_at < cutoff and name <> '（削除済み）';
  get diagnostics n_reservations = row_count;

  update sales set customer_name = null, note = null
  where business_date < (cutoff at time zone 'Asia/Tokyo')::date and customer_name is not null;
  get diagnostics n_sales = row_count;

  -- 最近の予約・メッセージがないお客様は、名前・SNSのID・メモを消す
  update customers c set name = null, display_name = null, external_id = null, note = null
  where c.created_at < cutoff
    and (c.name is not null or c.display_name is not null or c.external_id is not null or c.note is not null)
    and not exists (select 1 from reservations r where r.customer_id = c.id and r.end_at >= cutoff)
    and not exists (select 1 from messages m where m.customer_id = c.id);
  get diagnostics n_customers = row_count;

  delete from login_failures where created_at < now() - interval '1 day';
  delete from web_requests where created_at < now() - interval '1 day';

  return json_build_object(
    'messages', n_messages, 'reservations', n_reservations, 'sales', n_sales, 'customers', n_customers
  );
end;
$$;

revoke execute on function purge_personal_data(timestamptz) from public, anon, authenticated;
