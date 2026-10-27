ALTER TABLE staff_sessions
    ADD COLUMN ended_at DATETIME(3) NULL AFTER created_at,
    ADD COLUMN end_reason ENUM('LOGOUT', 'EXPIRED') NULL AFTER ended_at,
    ADD KEY ix_staff_sessions_staff_created (staff_id, created_at);

UPDATE staff_sessions
SET ended_at = expires_at, end_reason = 'EXPIRED'
WHERE ended_at IS NULL
  AND expires_at <= UTC_TIMESTAMP(3);
