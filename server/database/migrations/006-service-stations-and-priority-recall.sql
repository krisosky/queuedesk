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

INSERT INTO staff_service_points (staff_id, service_point_id, created_at)
SELECT account.staff_id, point.service_point_id, UTC_TIMESTAMP(3)
FROM staff_accounts AS account
INNER JOIN staff
    ON staff.staff_id = account.staff_id
    AND staff.is_active = TRUE
    AND account.is_active = TRUE
INNER JOIN service_points AS point ON point.is_active = TRUE;

ALTER TABLE queue_tickets
    ADD COLUMN priority_at DATETIME(3) NULL AFTER sequence_number,
    DROP INDEX ix_queue_tickets_waiting,
    ADD KEY ix_queue_tickets_waiting (queue_id, status, priority_at, sequence_number);

ALTER TABLE call_attempts
    ADD COLUMN call_round SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER ticket_id,
    DROP INDEX uq_call_attempts_ticket_attempt,
    ADD UNIQUE KEY uq_call_attempts_ticket_round_attempt
        (ticket_id, call_round, attempt_number);

ALTER TABLE staff_audit_events
    MODIFY COLUMN event_type ENUM(
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
    ) NOT NULL;
