-- Migration 0006: Seed default global notification toggle
INSERT INTO system_config ("key", "value")
SELECT 'global_notifications_enabled', 'true'
WHERE NOT EXISTS (
  SELECT 1 FROM system_config WHERE "key" = 'global_notifications_enabled'
);
