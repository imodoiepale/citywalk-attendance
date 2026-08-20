-- New permission for the device estate. Its own migration because Postgres
-- will not let a new enum value be referenced in the transaction that adds it,
-- and 20260820000003 seeds role_permissions rows using it.
alter type app_permission add value if not exists 'admin.devices';
