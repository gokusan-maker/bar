-- スタッフのログインID（IDとパスワードでのログイン用）

set search_path = bar, public;

alter table staff add column if not exists login_id text unique;
