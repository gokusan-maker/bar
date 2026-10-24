-- お客様リスト: 電話番号・誕生日・タグ。店で直接登録するお客様にも使う

set search_path = bar, public;

alter table customers add column if not exists phone text;
alter table customers add column if not exists birthday text check (birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
alter table customers add column if not exists tags text[] not null default '{}';

-- 予約フォーム（web・X）のお客様は、SNSのIDの代わりに電話番号を使っている
update customers set phone = external_id where channel in ('web', 'x') and phone is null;

create index if not exists customers_phone_idx on customers (phone);

-- 自動削除で匿名化するとき、電話番号・誕生日・タグも消す
create or replace function purge_personal_data(cutoff timestamptz)
returns json
language plpgsql
set search_path = bar
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

  -- 最近の予約・メッセージ・売上がないお客様は、名前・連絡先・メモを消す
  update customers c set name = null, display_name = null, external_id = null, note = null,
    phone = null, birthday = null, tags = '{}'
  where c.created_at < cutoff
    and (c.name is not null or c.display_name is not null or c.external_id is not null or c.note is not null
      or c.phone is not null or c.birthday is not null)
    and not exists (select 1 from reservations r where r.customer_id = c.id and r.end_at >= cutoff)
    and not exists (select 1 from messages m where m.customer_id = c.id)
    and not exists (select 1 from sales s where s.customer_id = c.id and s.business_date >= (cutoff at time zone 'Asia/Tokyo')::date);
  get diagnostics n_customers = row_count;

  delete from login_failures where created_at < now() - interval '1 day';
  delete from web_requests where created_at < now() - interval '1 day';

  return json_build_object(
    'messages', n_messages, 'reservations', n_reservations, 'sales', n_sales, 'customers', n_customers
  );
end;
$$;

revoke execute on function purge_personal_data(timestamptz) from public, anon, authenticated;
grant execute on function purge_personal_data(timestamptz) to service_role;
