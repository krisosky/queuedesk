CREATE TABLE staff_accounts (
    staff_id INT UNSIGNED NOT NULL,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (staff_id),
    UNIQUE KEY uq_staff_accounts_username (username),
    CONSTRAINT fk_staff_accounts_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id)
) ENGINE=InnoDB;

CREATE TABLE staff_sessions (
    token_hash CHAR(64) NOT NULL,
    staff_id INT UNSIGNED NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (token_hash),
    KEY ix_staff_sessions_expiry (expires_at),
    CONSTRAINT fk_staff_sessions_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE queue_tickets
    ADD COLUMN checked_in_by_staff_id INT UNSIGNED NULL AFTER requeued_from_ticket_id,
    ADD CONSTRAINT fk_queue_tickets_checked_in_by_staff
        FOREIGN KEY (checked_in_by_staff_id) REFERENCES staff (staff_id);

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
        'SERVICE_COMPLETED'
    ) NOT NULL,
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
