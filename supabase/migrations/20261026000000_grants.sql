-- bar スキーマはサーバー（service_role）だけが読み書きする。anon・authenticated には権限を与えない。

grant usage on schema bar to service_role;
grant all on all tables in schema bar to service_role;
grant all on all sequences in schema bar to service_role;
grant execute on function bar.purge_personal_data(timestamptz) to service_role;
