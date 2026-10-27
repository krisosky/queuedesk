INSERT INTO service_points (name, created_at)
SELECT 'Service point 1', UTC_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM service_points);

INSERT IGNORE INTO service_point_service_types (service_point_id, service_type_id)
SELECT sp.service_point_id, sst.service_type_id
FROM service_points AS sp
CROSS JOIN staff_service_types AS sst
INNER JOIN service_types AS st
    ON st.service_type_id = sst.service_type_id AND st.is_active = TRUE
WHERE sp.name = 'Service point 1';

UPDATE call_attempts AS ca
INNER JOIN queue_tickets AS t ON t.ticket_id = ca.ticket_id
INNER JOIN staff_service_types AS sst
    ON sst.staff_id = ca.staff_id AND sst.service_type_id = t.service_type_id
INNER JOIN service_point_service_types AS spt
    ON spt.service_type_id = t.service_type_id
SET ca.service_point_id = spt.service_point_id
WHERE ca.service_point_id IS NULL;

UPDATE service_records AS sr
INNER JOIN queue_tickets AS t ON t.ticket_id = sr.ticket_id
INNER JOIN staff_service_types AS sst
    ON sst.staff_id = sr.staff_id AND sst.service_type_id = t.service_type_id
INNER JOIN service_point_service_types AS spt
    ON spt.service_type_id = t.service_type_id
SET sr.service_point_id = spt.service_point_id
WHERE sr.service_point_id IS NULL;
