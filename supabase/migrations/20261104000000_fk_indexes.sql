-- 外部キーの索引（お客様・スタッフ・注文から売上をたどるとき、削除のときに速くする）

set search_path = bar, public;

create index if not exists customers_staff_idx on customers (staff_id);
create index if not exists drafts_shop_idx on drafts (shop_id);
create index if not exists orders_sale_idx on orders (sale_id);
create index if not exists sale_attachments_shop_idx on sale_attachments (shop_id);
create index if not exists sales_customer_idx on sales (customer_id);
create index if not exists sales_staff_idx on sales (staff_id);
