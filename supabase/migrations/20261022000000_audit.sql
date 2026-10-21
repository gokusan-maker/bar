-- 操作履歴（誰が・いつ・何をしたか）

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null check (actor in ('owner', 'staff', 'guest', 'system')),
  action text not null,
  target_type text not null,
  -- 対象が削除されても履歴は残すため外部キーにしない
  target_id text,
  detail text,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);
create index if not exists audit_logs_target_idx on audit_logs (target_id, created_at desc);

alter table audit_logs enable row level security;
