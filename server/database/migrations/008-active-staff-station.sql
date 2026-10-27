ALTER TABLE staff_sessions
    ADD COLUMN active_service_point_id INT UNSIGNED NULL AFTER end_reason,
    ADD COLUMN station_updated_at DATETIME(3) NULL AFTER active_service_point_id,
    ADD KEY ix_staff_sessions_active_station (staff_id, active_service_point_id),
    ADD CONSTRAINT fk_staff_sessions_active_service_point
        FOREIGN KEY (active_service_point_id) REFERENCES service_points (service_point_id)
        ON DELETE SET NULL;
