CREATE TABLE service_points (
    service_point_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (service_point_id),
    UNIQUE KEY uq_service_points_name (name)
) ENGINE=InnoDB;

CREATE TABLE service_point_service_types (
    service_point_id INT UNSIGNED NOT NULL,
    service_type_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (service_point_id, service_type_id),
    CONSTRAINT fk_service_point_types_point
        FOREIGN KEY (service_point_id) REFERENCES service_points (service_point_id),
    CONSTRAINT fk_service_point_types_service
        FOREIGN KEY (service_type_id) REFERENCES service_types (service_type_id)
) ENGINE=InnoDB;

ALTER TABLE call_attempts
    MODIFY COLUMN staff_id INT UNSIGNED NULL,
    ADD COLUMN service_point_id INT UNSIGNED NULL AFTER staff_id,
    ADD CONSTRAINT fk_call_attempts_service_point
        FOREIGN KEY (service_point_id) REFERENCES service_points (service_point_id);

ALTER TABLE service_records
    MODIFY COLUMN staff_id INT UNSIGNED NULL,
    ADD COLUMN service_point_id INT UNSIGNED NULL AFTER staff_id,
    ADD CONSTRAINT fk_service_records_service_point
        FOREIGN KEY (service_point_id) REFERENCES service_points (service_point_id);
