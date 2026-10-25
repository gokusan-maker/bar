-- 店舗をまたいで同じ電話番号のお客様が登録できるように、店舗なしの重複チェックを外す
-- （店舗ごとの重複チェックは customers_shop_channel_external_key）

set search_path = bar, public;

alter table customers drop constraint if exists customers_channel_external_id_key;
