REVOKE ALL ON documents, frames, custody FROM "{{name}}";
REVOKE USAGE ON SEQUENCE custody_id_seq FROM "{{name}}";
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{{name}}';
DROP ROLE IF EXISTS "{{name}}";
