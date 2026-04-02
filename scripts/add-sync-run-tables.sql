-- Auditoría import Holded → CRM (idempotente; también creado en runtime por ensureSyncRunTables).

CREATE TABLE IF NOT EXISTS sync_run (
  sync_run_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_started_at DATETIME NOT NULL,
  sync_finished_at DATETIME NULL,
  sync_source VARCHAR(64) NOT NULL,
  sync_rows_total INT NULL,
  sync_inserted INT NULL,
  sync_updated INT NULL,
  sync_skipped INT NULL,
  sync_errors INT NULL,
  sync_holded_tag_errors INT NULL,
  sync_error_first VARCHAR(512) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sync_event (
  sync_event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_run_id BIGINT UNSIGNED NOT NULL,
  holded_contact_id VARCHAR(255) NULL,
  cli_id INT NULL,
  action VARCHAR(32) NOT NULL,
  result VARCHAR(32) NOT NULL,
  detail VARCHAR(512) NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_sync_run (sync_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
