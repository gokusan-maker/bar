-- 誕生日のお祝いメッセージ（同じ年に二重に送らないための記録）

set search_path = bar, public;

alter table customers add column if not exists birthday_greeted_year integer;
