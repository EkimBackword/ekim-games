\getenv migration_password MIGRATION_DB_PASSWORD
\getenv app_password APP_DB_PASSWORD
\getenv create_shadow_database CREATE_SHADOW_DATABASE

SELECT format('CREATE ROLE ekim_games_migrate LOGIN PASSWORD %L', :'migration_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ekim_games_migrate')
\gexec

ALTER ROLE ekim_games_migrate
  WITH LOGIN PASSWORD :'migration_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

SELECT format('CREATE ROLE ekim_games_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ekim_games_app')
\gexec

ALTER ROLE ekim_games_app
  WITH LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

ALTER DATABASE ekim_games OWNER TO ekim_games_migrate;
ALTER SCHEMA public OWNER TO ekim_games_migrate;
GRANT CONNECT ON DATABASE ekim_games TO ekim_games_migrate;

DO $$
DECLARE
  object_record record;
  object_kind text;
BEGIN
  FOR object_record IN
    SELECT namespace.nspname, relation.relname, relation.relkind
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relowner = 'ekim_games'::regrole
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  LOOP
    object_kind := CASE object_record.relkind
      WHEN 'S' THEN 'SEQUENCE'
      WHEN 'v' THEN 'VIEW'
      WHEN 'm' THEN 'MATERIALIZED VIEW'
      WHEN 'f' THEN 'FOREIGN TABLE'
      ELSE 'TABLE'
    END;

    EXECUTE format(
      'ALTER %s %I.%I OWNER TO ekim_games_migrate',
      object_kind,
      object_record.nspname,
      object_record.relname
    );
  END LOOP;

  FOR object_record IN
    SELECT data_type.typname, namespace.nspname, data_type.typtype
    FROM pg_type AS data_type
    JOIN pg_namespace AS namespace ON namespace.oid = data_type.typnamespace
    WHERE namespace.nspname = 'public'
      AND data_type.typowner = 'ekim_games'::regrole
      AND data_type.typrelid = 0
      AND data_type.typtype IN ('c', 'd', 'e', 'm', 'r')
  LOOP
    object_kind := CASE object_record.typtype
      WHEN 'd' THEN 'DOMAIN'
      ELSE 'TYPE'
    END;

    EXECUTE format(
      'ALTER %s %I.%I OWNER TO ekim_games_migrate',
      object_kind,
      object_record.nspname,
      object_record.typname
    );
  END LOOP;
END;
$$;

GRANT CONNECT ON DATABASE ekim_games TO ekim_games_app;
GRANT USAGE ON SCHEMA public TO ekim_games_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ekim_games_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ekim_games_app;

ALTER DEFAULT PRIVILEGES FOR ROLE ekim_games_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ekim_games_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ekim_games_migrate IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ekim_games_app;

\if :create_shadow_database
SELECT format('CREATE DATABASE ekim_games_shadow OWNER ekim_games_migrate')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ekim_games_shadow')
\gexec
ALTER DATABASE ekim_games_shadow OWNER TO ekim_games_migrate;
\endif
