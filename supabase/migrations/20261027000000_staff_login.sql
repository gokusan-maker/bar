-- スタッフが自分の名前とパスワードでログインできるようにする（招待リンクから登録し、店主が承認）

set search_path = bar, public;

alter table staff add column if not exists password_hash text;
alter table staff add column if not exists pending boolean not null default false;
