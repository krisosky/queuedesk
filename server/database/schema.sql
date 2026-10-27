CREATE TABLE service_types (
    service_type_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (service_type_id),
    UNIQUE KEY uq_service_types_name (name)
) ENGINE=InnoDB;

CREATE TABLE app_settings (
    setting_key VARCHAR(100) NOT NULL,
    setting_value VARCHAR(255) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('ticket_printing_enabled', 'false', UTC_TIMESTAMP(3));

CREATE TABLE staff (
    staff_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    display_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (staff_id)
) ENGINE=InnoDB;

CREATE TABLE staff_accounts (
    staff_id INT UNSIGNED NOT NULL,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (staff_id),
    UNIQUE KEY uq_staff_accounts_username (username),
    CONSTRAINT fk_staff_accounts_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id)
) ENGINE=InnoDB;

CREATE TABLE staff_service_types (
    staff_id INT UNSIGNED NOT NULL,
    service_type_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (staff_id, service_type_id),
    CONSTRAINT fk_staff_service_types_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
    CONSTRAINT fk_staff_service_types_service
        FOREIGN KEY (service_type_id) REFERENCES service_types (service_type_id)
) ENGINE=InnoDB;

CREATE TABLE service_points (
    service_point_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (service_point_id),
    UNIQUE KEY uq_service_points_name (name)
) ENGINE=InnoDB;

CREATE TABLE staff_sessions (
    token_hash CHAR(64) NOT NULL,
    staff_id INT UNSIGNED NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    end_reason ENUM('LOGOUT', 'EXPIRED') NULL,
    active_service_point_id INT UNSIGNED NULL,
    station_updated_at DATETIME(3) NULL,
    PRIMARY KEY (token_hash),
    KEY ix_staff_sessions_expiry (expires_at),
    KEY ix_staff_sessions_staff_created (staff_id, created_at),
    KEY ix_staff_sessions_active_station (staff_id, active_service_point_id),
    CONSTRAINT fk_staff_sessions_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_staff_sessions_active_service_point
        FOREIGN KEY (active_service_point_id) REFERENCES service_points (service_point_id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE staff_service_points (
    staff_id INT UNSIGNED NOT NULL,
    service_point_id INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (staff_id, service_point_id),
    KEY ix_staff_service_points_point (service_point_id),
    CONSTRAINT fk_staff_service_points_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
    CONSTRAINT fk_staff_service_points_point
        FOREIGN KEY (service_point_id) REFERENCES service_points (service_point_id)
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

CREATE TABLE daily_queues (
    queue_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    queue_date DATE NOT NULL,
    status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    opened_at DATETIME(3) NOT NULL,
    closed_at DATETIME(3) NULL,
    PRIMARY KEY (queue_id),
    UNIQUE KEY uq_daily_queues_queue_date (queue_date)
) ENGINE=InnoDB;

CREATE TABLE queue_tickets (
    ticket_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    queue_id INT UNSIGNED NOT NULL,
    service_type_id INT UNSIGNED NOT NULL,
    requeued_from_ticket_id INT UNSIGNED NULL,
    checked_in_by_staff_id INT UNSIGNED NULL,
    sequence_number INT UNSIGNED NOT NULL,
    priority_at DATETIME(3) NULL,
    status ENUM(
        'WAITING',
        'CALLED',
        'IN_SERVICE',
        'COMPLETED',
        'NO_SHOW',
        'CANCELLED'
    ) NOT NULL DEFAULT 'WAITING',
    checked_in_at DATETIME(3) NOT NULL,
    PRIMARY KEY (ticket_id),
    UNIQUE KEY uq_queue_tickets_sequence (queue_id, sequence_number),
    KEY ix_queue_tickets_waiting (queue_id, status, priority_at, sequence_number),
    KEY ix_queue_tickets_requeued_from (requeued_from_ticket_id),
    CONSTRAINT fk_queue_tickets_queue
        FOREIGN KEY (queue_id) REFERENCES daily_queues (queue_id),
    CONSTRAINT fk_queue_tickets_service
        FOREIGN KEY (service_type_id) REFERENCES service_types (service_type_id),
    CONSTRAINT fk_queue_tickets_requeued_from
        FOREIGN KEY (requeued_from_ticket_id) REFERENCES queue_tickets (ticket_id),
    CONSTRAINT fk_queue_tickets_checked_in_by_staff
        FOREIGN KEY (checked_in_by_staff_id) REFERENCES staff (staff_id)
) ENGINE=InnoDB;

CREATE TABLE call_attempts (
    call_attempt_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticket_id INT UNSIGNED NOT NULL,
    call_round SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    staff_id INT UNSIGNED NULL,
    service_point_id INT UNSIGNED NULL,
    attempt_number TINYINT UNSIGNED NOT NULL,
    outcome ENUM('PENDING', 'ACKNOWLEDGED', 'NO_RESPONSE') NOT NULL DEFAULT 'PENDING',
    called_at DATETIME(3) NOT NULL,
    PRIMARY KEY (call_attempt_id),
    UNIQUE KEY uq_call_attempts_ticket_round_attempt (ticket_id, call_round, attempt_number),
    CONSTRAINT fk_call_attempts_ticket
        FOREIGN KEY (ticket_id) REFERENCES queue_tickets (ticket_id),
    CONSTRAINT fk_call_attempts_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
    CONSTRAINT fk_call_attempts_service_point
        FOREIGN KEY (service_point_id) REFERENCES service_points (service_point_id),
    CONSTRAINT chk_call_attempts_attempt_number CHECK (attempt_number IN (1, 2))
) ENGINE=InnoDB;

CREATE TABLE service_records (
    service_record_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticket_id INT UNSIGNED NOT NULL,
    staff_id INT UNSIGNED NULL,
    service_point_id INT UNSIGNED NULL,
    started_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (service_record_id),
    UNIQUE KEY uq_service_records_ticket (ticket_id),
    CONSTRAINT fk_service_records_ticket
        FOREIGN KEY (ticket_id) REFERENCES queue_tickets (ticket_id),
    CONSTRAINT fk_service_records_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
    CONSTRAINT fk_service_records_service_point
        FOREIGN KEY (service_point_id) REFERENCES service_points (service_point_id)
) ENGINE=InnoDB;

CREATE TABLE staff_audit_events (
    audit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    staff_id INT UNSIGNED NOT NULL,
    ticket_id INT UNSIGNED NULL,
    service_point_id INT UNSIGNED NULL,
    event_type ENUM(
        'ASSISTED_CHECK_IN',
        'REJOINED_TICKET',
        'CALLED_TICKET',
        'CALL_ACKNOWLEDGED',
        'CALL_NO_RESPONSE',
        'REPEATED_CALL',
        'MARKED_NO_SHOW',
        'SERVICE_STARTED',
        'SERVICE_COMPLETED',
        'SERVICE_CREATED',
        'SERVICE_UPDATED',
        'SERVICE_POINT_CREATED',
        'SERVICE_POINT_UPDATED',
        'SERVICE_POINT_SERVICES_UPDATED',
        'STAFF_ACCOUNT_CREATED',
        'STAFF_ACCOUNT_UPDATED',
        'TICKET_RETURNED_TO_QUEUE'
    ) NOT NULL,
    subject_name VARCHAR(160) NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (audit_event_id),
    KEY ix_staff_audit_events_created (created_at),
    KEY ix_staff_audit_events_ticket (ticket_id, created_at),
    CONSTRAINT fk_staff_audit_events_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
    CONSTRAINT fk_staff_audit_events_ticket
        FOREIGN KEY (ticket_id) REFERENCES queue_tickets (ticket_id),
    CONSTRAINT fk_staff_audit_events_service_point
        FOREIGN KEY (service_point_id) REFERENCES service_points (service_point_id)
) ENGINE=InnoDB;
