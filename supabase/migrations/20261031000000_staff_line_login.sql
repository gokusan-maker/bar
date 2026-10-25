-- スタッフがLINEでログインできるようにする（LINEログインで確認したユーザーID）

set search_path = bar, public;

alter table staff add column if not exists line_user_id text unique;
