-- X（Twitter）用の予約リンクからの受付を、経路 x として記録する

alter table customers drop constraint if exists customers_channel_check;
alter table customers add constraint customers_channel_check
  check (channel in ('line', 'instagram', 'x', 'web', 'simulator', 'manual'));

alter table sales drop constraint if exists sales_channel_check;
alter table sales add constraint sales_channel_check
  check (channel in ('line', 'instagram', 'x', 'web', 'simulator', 'manual'));
