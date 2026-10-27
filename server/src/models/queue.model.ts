import type { PoolConnection } from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, withTransaction } from '../db/pool.js';

export type TicketStatus =
  | 'WAITING'
  | 'CALLED'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED';

export type CallOutcome = 'ACKNOWLEDGED' | 'NO_RESPONSE';

export interface WaitingTicket {
  ticketId: number;
  sequenceNumber: number;
  serviceTypeId: number;
  serviceTypeName: string;
  checkedInAt: Date | string;
}

export interface NoShowTicket {
  ticketId: number;
  sequenceNumber: number;
  serviceTypeId: number;
  serviceTypeName: string;
  checkedInAt: Date | string;
}

export interface CalledTicket {
  ticketId: number;
  sequenceNumber: number;
  serviceTypeName: string;
  attemptNumber: number;
}

export interface ServiceTypeOption {
  serviceTypeId: number;
  name: string;
}

export interface StaffOption {
  staffId: number;
  displayName: string;
}

export interface ServicePointOption {
  servicePointId: number;
  name: string;
  serviceTypeIds: number[];
}

export interface ActiveTicket {
  ticketId: number;
  sequenceNumber: number;
  serviceTypeName: string;
  status: 'CALLED' | 'IN_SERVICE';
  attemptNumber: number;
  callOutcome: 'PENDING' | CallOutcome;
  servicePointId: number | null;
  servicePointName: string;
  staffId: number | null;
  staffName: string | null;
}

export type StaffAuditEventType =
  | 'ASSISTED_CHECK_IN'
  | 'REJOINED_TICKET'
  | 'CALLED_TICKET'
  | 'CALL_ACKNOWLEDGED'
  | 'CALL_NO_RESPONSE'
  | 'REPEATED_CALL'
  | 'MARKED_NO_SHOW'
  | 'SERVICE_STARTED'
  | 'SERVICE_COMPLETED'
  | 'SERVICE_CREATED'
  | 'SERVICE_UPDATED'
  | 'SERVICE_POINT_CREATED'
  | 'SERVICE_POINT_UPDATED'
  | 'SERVICE_POINT_SERVICES_UPDATED'
  | 'STAFF_ACCOUNT_CREATED'
  | 'STAFF_ACCOUNT_UPDATED'
  | 'TICKET_RETURNED_TO_QUEUE';

export interface StaffAuditEvent {
  auditEventId: number;
  eventType: StaffAuditEventType;
  staffName: string;
  sequenceNumber: number | null;
  servicePointName: string | null;
  subjectName: string | null;
  createdAt: Date | string;
}

interface QueueRow extends RowDataPacket {
  queue_id: number;
  status: 'OPEN' | 'CLOSED';
}

interface TicketRow extends RowDataPacket {
  ticket_id: number;
  queue_id: number;
  service_type_id: number;
  sequence_number: number;
  status: TicketStatus;
}

interface WaitingTicketRow extends RowDataPacket {
  ticket_id: number;
  sequence_number: number;
  service_type_id: number;
  service_type_name: string;
  checked_in_at: Date | string;
}

interface CalledTicketRow extends RowDataPacket {
  ticket_id: number;
  sequence_number: number;
  service_type_id: number;
  service_type_name: string;
}

interface AttemptRow extends RowDataPacket {
  call_round: number;
  attempt_number: number;
  outcome: 'PENDING' | CallOutcome;
  staff_id: number | null;
  service_point_id: number | null;
}

interface ServiceTypeOptionRow extends RowDataPacket {
  service_type_id: number;
  name: string;
}

interface ServiceTypeRecordRow extends RowDataPacket {
  service_type_id: number;
  name: string;
}

interface StaffOptionRow extends RowDataPacket {
  staff_id: number;
  display_name: string;
}

interface ActiveTicketRow extends RowDataPacket {
  ticket_id: number;
  sequence_number: number;
  service_type_name: string;
  status: 'CALLED' | 'IN_SERVICE';
  attempt_number: number;
  call_outcome: 'PENDING' | CallOutcome;
  service_point_id: number | null;
  service_point_name: string | null;
  subject_name: string | null;
  staff_id: number | null;
  staff_name: string | null;
}

interface ServicePointRow extends RowDataPacket {
  service_point_id: number;
  name: string;
  service_type_id: number | null;
}

interface NoShowTicketRow extends RowDataPacket {
  ticket_id: number;
  sequence_number: number;
  service_type_id: number;
  service_type_name: string;
  checked_in_at: Date | string;
}

interface StaffAuditEventRow extends RowDataPacket {
  audit_event_id: number;
  event_type: StaffAuditEventType;
  staff_name: string;
  sequence_number: number | null;
  service_point_name: string | null;
  created_at: Date | string;
}

async function recordStaffEvent(
  connection: PoolConnection,
  staffId: number,
  ticketId: number,
  eventType: StaffAuditEventType,
  servicePointId?: number
): Promise<void> {
  await connection.execute(
    `INSERT INTO staff_audit_events
       (staff_id, ticket_id, service_point_id, event_type, created_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [staffId, ticketId, servicePointId ?? null, eventType]
  );
}

export class QueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueError';
  }
}

export async function getServiceTypes(): Promise<ServiceTypeOption[]> {
  const [rows] = await pool.execute<ServiceTypeOptionRow[]>(
    `SELECT service_type_id, name
     FROM service_types
     WHERE is_active = TRUE
     ORDER BY name ASC`
  );

  return rows.map((row) => ({
    serviceTypeId: row.service_type_id,
    name: row.name
  }));
}

export async function getActiveStaff(): Promise<StaffOption[]> {
  const [rows] = await pool.execute<StaffOptionRow[]>(
    `SELECT staff_id, display_name
     FROM staff
     WHERE is_active = TRUE
     ORDER BY display_name ASC`
  );

  return rows.map((row) => ({
    staffId: row.staff_id,
    displayName: row.display_name
  }));
}

export async function getActiveServicePoints(staffId?: number): Promise<ServicePointOption[]> {
  if (staffId !== undefined) {
    assertPositiveInteger(staffId, 'staffId');
  }
  const assignmentFilter =
    staffId === undefined
      ? ''
      : `AND EXISTS (
           SELECT 1 FROM staff_service_points AS assignment
           WHERE assignment.staff_id = ?
             AND assignment.service_point_id = sp.service_point_id
         )`;
  const [rows] = await pool.execute<ServicePointRow[]>(
    `SELECT
       sp.service_point_id,
       sp.name,
       sps.service_type_id
     FROM service_points AS sp
     LEFT JOIN service_point_service_types AS sps
       ON sps.service_point_id = sp.service_point_id
     WHERE sp.is_active = TRUE
       ${assignmentFilter}
     ORDER BY sp.name ASC, sps.service_type_id ASC`,
    staffId === undefined ? [] : [staffId]
  );

  const points = new Map<number, ServicePointOption>();
  for (const row of rows) {
    let point = points.get(row.service_point_id);
    if (!point) {
      point = {
        servicePointId: row.service_point_id,
        name: row.name,
        serviceTypeIds: []
      };
      points.set(row.service_point_id, point);
    }
    if (row.service_type_id !== null) {
      point.serviceTypeIds.push(row.service_type_id);
    }
  }

  return [...points.values()];
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new QueueError(`${name} must be a positive integer`);
  }
}

async function getOpenQueue(
  connection: PoolConnection,
  queueId: number
): Promise<QueueRow> {
  const [rows] = await connection.execute<QueueRow[]>(
    'SELECT queue_id, status FROM daily_queues WHERE queue_id = ? FOR UPDATE',
    [queueId]
  );
  const queue = rows[0];

  if (!queue) {
    throw new QueueError('Queue does not exist');
  }
  if (queue.status !== 'OPEN') {
    throw new QueueError('Queue is closed');
  }

  return queue;
}

async function getTicket(
  connection: PoolConnection,
  ticketId: number
): Promise<TicketRow> {
  const [rows] = await connection.execute<TicketRow[]>(
    `SELECT ticket_id, queue_id, service_type_id, sequence_number, status
     FROM queue_tickets
     WHERE ticket_id = ?
     FOR UPDATE`,
    [ticketId]
  );
  const ticket = rows[0];

  if (!ticket) {
    throw new QueueError('Ticket does not exist');
  }

  return ticket;
}

async function getLatestAttempt(
  connection: PoolConnection,
  ticketId: number
): Promise<AttemptRow | undefined> {
  const [rows] = await connection.execute<AttemptRow[]>(
    `SELECT call_round, attempt_number, outcome, staff_id, service_point_id
     FROM call_attempts
     WHERE ticket_id = ?
     ORDER BY call_round DESC, attempt_number DESC
     LIMIT 1
     FOR UPDATE`,
    [ticketId]
  );

  return rows[0];
}

async function assertAssignedServicePoint(
  connection: PoolConnection,
  staffId: number,
  servicePointId: number
): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT point.service_point_id
     FROM staff_service_points AS assignment
     INNER JOIN service_points AS point
       ON point.service_point_id = assignment.service_point_id AND point.is_active = TRUE
     WHERE assignment.staff_id = ? AND assignment.service_point_id = ?
     LIMIT 1`,
    [staffId, servicePointId]
  );
  if (rows.length === 0) {
    throw new QueueError('You are not assigned to this active service station.');
  }
}

async function assertStaffCanManageTicket(
  connection: PoolConnection,
  ticketId: number,
  staffId: number
): Promise<AttemptRow> {
  const attempt = await getLatestAttempt(connection, ticketId);
  if (!attempt?.service_point_id) {
    throw new QueueError('The ticket is not assigned to a service station.');
  }
  await assertAssignedServicePoint(connection, staffId, attempt.service_point_id);
  return attempt;
}

export async function openDailyQueue(queueDate: string): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(queueDate)) {
    throw new QueueError('queueDate must use YYYY-MM-DD format in the location timezone');
  }

  await pool.execute(
    `INSERT INTO daily_queues (queue_date, opened_at)
     VALUES (?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE queue_id = queue_id`,
    [queueDate]
  );
  const [rows] = await pool.execute<QueueRow[]>(
    'SELECT queue_id, status FROM daily_queues WHERE queue_date = ?',
    [queueDate]
  );
  const queue = rows[0];
  if (!queue) {
    throw new Error('The daily queue could not be created or retrieved');
  }
  if (queue.status !== 'OPEN') {
    throw new QueueError('The daily queue is closed');
  }

  return queue.queue_id;
}

export async function checkInWalkIn(
  queueId: number,
  serviceTypeId: number,
  requeuedFromTicketId?: number,
  staffId?: number
): Promise<{ ticketId: number; sequenceNumber: number }> {
  assertPositiveInteger(queueId, 'queueId');
  assertPositiveInteger(serviceTypeId, 'serviceTypeId');
  if (requeuedFromTicketId !== undefined) {
    assertPositiveInteger(requeuedFromTicketId, 'requeuedFromTicketId');
  }

  return withTransaction(async (connection) => {
    await getOpenQueue(connection, queueId);

    if (requeuedFromTicketId !== undefined) {
      const originalTicket = await getTicket(connection, requeuedFromTicketId);
      if (originalTicket.queue_id !== queueId || originalTicket.status !== 'NO_SHOW') {
        throw new QueueError('Only a no-show ticket from this queue can be requeued');
      }

      const [existingRequeues] = await connection.execute<RowDataPacket[]>(
        'SELECT ticket_id FROM queue_tickets WHERE requeued_from_ticket_id = ? LIMIT 1',
        [requeuedFromTicketId]
      );
      if (existingRequeues.length > 0) {
        throw new QueueError('This no-show ticket has already been requeued');
      }
    }

    const [serviceRows] = await connection.execute<ServiceTypeRecordRow[]>(
      'SELECT service_type_id, name FROM service_types WHERE service_type_id = ? AND is_active = TRUE',
      [serviceTypeId]
    );
    const serviceType = serviceRows[0];
    if (!serviceType) {
      throw new QueueError('Service type does not exist or is inactive');
    }

    const [servicePointRows] = await connection.execute<RowDataPacket[]>(
      `SELECT sp.service_point_id
       FROM service_point_service_types AS spt
       INNER JOIN service_points AS sp
         ON sp.service_point_id = spt.service_point_id AND sp.is_active = TRUE
       WHERE spt.service_type_id = ?
       LIMIT 1`,
      [serviceTypeId]
    );
    if (servicePointRows.length === 0) {
      throw new QueueError('No active service point is configured for this service');
    }

    const [sequenceRows] = await connection.execute<
      (RowDataPacket & { next_sequence: number })[]
    >(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
       FROM queue_tickets
       WHERE queue_id = ?`,
      [queueId]
    );
    const sequenceNumber = sequenceRows[0]?.next_sequence;
    if (sequenceNumber === undefined) {
      throw new Error('Could not allocate a ticket number');
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO queue_tickets
         (queue_id, service_type_id, requeued_from_ticket_id, checked_in_by_staff_id,
          sequence_number, checked_in_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [queueId, serviceTypeId, requeuedFromTicketId ?? null, staffId ?? null, sequenceNumber]
    );

    if (staffId !== undefined) {
      await recordStaffEvent(
        connection,
        staffId,
        result.insertId,
        requeuedFromTicketId === undefined ? 'ASSISTED_CHECK_IN' : 'REJOINED_TICKET'
      );
    }

    return {
      ticketId: result.insertId,
      sequenceNumber,
      serviceTypeName: serviceType.name
    };
  });
}

export async function getWaitingTickets(queueId: number): Promise<WaitingTicket[]> {
  assertPositiveInteger(queueId, 'queueId');

  const [rows] = await pool.execute<WaitingTicketRow[]>(
    `SELECT
       t.ticket_id,
       t.sequence_number,
       t.service_type_id,
       st.name AS service_type_name,
       t.checked_in_at
     FROM queue_tickets AS t
     INNER JOIN service_types AS st ON st.service_type_id = t.service_type_id
     WHERE t.queue_id = ? AND t.status = 'WAITING'
     ORDER BY t.priority_at IS NULL ASC, t.priority_at ASC, t.sequence_number ASC`,
    [queueId]
  );

  return rows.map((row) => ({
    ticketId: row.ticket_id,
    sequenceNumber: row.sequence_number,
    serviceTypeId: row.service_type_id,
    serviceTypeName: row.service_type_name,
    checkedInAt: row.checked_in_at
  }));
}

export async function getNoShowTickets(queueId: number): Promise<NoShowTicket[]> {
  assertPositiveInteger(queueId, 'queueId');

  const [rows] = await pool.execute<NoShowTicketRow[]>(
    `SELECT
       t.ticket_id,
       t.sequence_number,
       t.service_type_id,
       st.name AS service_type_name,
       t.checked_in_at
     FROM queue_tickets AS t
     INNER JOIN service_types AS st ON st.service_type_id = t.service_type_id
     WHERE t.queue_id = ?
       AND t.status = 'NO_SHOW'
       AND NOT EXISTS (
         SELECT 1
         FROM queue_tickets AS requeued
         WHERE requeued.requeued_from_ticket_id = t.ticket_id
       )
     ORDER BY t.sequence_number ASC`,
    [queueId]
  );

  return rows.map((row) => ({
    ticketId: row.ticket_id,
    sequenceNumber: row.sequence_number,
    serviceTypeId: row.service_type_id,
    serviceTypeName: row.service_type_name,
    checkedInAt: row.checked_in_at
  }));
}

export async function getActiveTickets(queueId: number): Promise<ActiveTicket[]> {
  assertPositiveInteger(queueId, 'queueId');

  const [rows] = await pool.execute<ActiveTicketRow[]>(
    `SELECT
       t.ticket_id,
       t.sequence_number,
       st.name AS service_type_name,
       t.status,
       ca.attempt_number,
       ca.outcome AS call_outcome,
       COALESCE(sr.staff_id, ca.staff_id) AS staff_id,
       s.display_name AS staff_name,
       COALESCE(sr.service_point_id, ca.service_point_id) AS service_point_id,
       sp.name AS service_point_name
     FROM queue_tickets AS t
     INNER JOIN service_types AS st ON st.service_type_id = t.service_type_id
     LEFT JOIN call_attempts AS ca
       ON ca.ticket_id = t.ticket_id
       AND ca.call_attempt_id = (
         SELECT latest.call_attempt_id
         FROM call_attempts AS latest
         WHERE latest.ticket_id = t.ticket_id
         ORDER BY latest.call_round DESC, latest.attempt_number DESC
         LIMIT 1
       )
     LEFT JOIN service_records AS sr ON sr.ticket_id = t.ticket_id
     LEFT JOIN staff AS s ON s.staff_id = COALESCE(sr.staff_id, ca.staff_id)
     LEFT JOIN service_points AS sp
       ON sp.service_point_id = COALESCE(sr.service_point_id, ca.service_point_id)
     WHERE t.queue_id = ? AND t.status IN ('CALLED', 'IN_SERVICE')
     ORDER BY t.sequence_number ASC`,
    [queueId]
  );

  return rows.map((row) => ({
    ticketId: row.ticket_id,
    sequenceNumber: row.sequence_number,
    serviceTypeName: row.service_type_name,
    status: row.status,
    attemptNumber: row.attempt_number,
    callOutcome: row.call_outcome,
    staffId: row.staff_id,
    staffName: row.staff_name,
    servicePointId: row.service_point_id,
    servicePointName: row.service_point_name ?? row.staff_name ?? 'Unassigned service point'
  }));
}

export async function callNextTicket(
  queueId: number,
  servicePointId: number,
  staffId: number
): Promise<CalledTicket | null> {
  assertPositiveInteger(queueId, 'queueId');
  assertPositiveInteger(servicePointId, 'servicePointId');
  assertPositiveInteger(staffId, 'staffId');

  return withTransaction(async (connection) => {
    await getOpenQueue(connection, queueId);
    await assertAssignedServicePoint(connection, staffId, servicePointId);

    const [servicePointRows] = await connection.execute<RowDataPacket[]>(
      'SELECT service_point_id FROM service_points WHERE service_point_id = ? AND is_active = TRUE FOR UPDATE',
      [servicePointId]
    );
    if (servicePointRows.length === 0) {
      throw new QueueError('Service point does not exist or is inactive');
    }

    const [activeRows] = await connection.execute<RowDataPacket[]>(
      `SELECT ticket_id
       FROM queue_tickets
       WHERE queue_id = ? AND status IN ('CALLED', 'IN_SERVICE')
         AND ticket_id IN (
           SELECT ticket_id FROM call_attempts WHERE service_point_id = ?
           UNION
           SELECT ticket_id FROM service_records WHERE service_point_id = ?
         )
       LIMIT 1`,
      [queueId, servicePointId, servicePointId]
    );
    if (activeRows.length > 0) {
      throw new QueueError('This service point already has a customer in progress');
    }

    const [rows] = await connection.execute<CalledTicketRow[]>(
      `SELECT
         t.ticket_id,
         t.sequence_number,
         t.service_type_id,
         st.name AS service_type_name
       FROM queue_tickets AS t
       INNER JOIN service_types AS st ON st.service_type_id = t.service_type_id
       INNER JOIN service_point_service_types AS spt
         ON spt.service_type_id = t.service_type_id AND spt.service_point_id = ?
       WHERE t.queue_id = ? AND t.status = 'WAITING' AND st.is_active = TRUE
       ORDER BY t.priority_at IS NULL ASC, t.priority_at ASC, t.sequence_number ASC
       LIMIT 1
       FOR UPDATE`,
      [servicePointId, queueId]
    );
    const ticket = rows[0];

    if (!ticket) {
      return null;
    }

    await connection.execute(
      "UPDATE queue_tickets SET status = 'CALLED' WHERE ticket_id = ? AND status = 'WAITING'",
      [ticket.ticket_id]
    );
    await connection.execute(
      `INSERT INTO call_attempts
         (ticket_id, call_round, staff_id, service_point_id, attempt_number, called_at)
       SELECT ?, COALESCE(MAX(call_round), 0) + 1, ?, ?, 1, UTC_TIMESTAMP(3)
       FROM call_attempts
       WHERE ticket_id = ?`,
      [ticket.ticket_id, staffId, servicePointId, ticket.ticket_id]
    );
    await recordStaffEvent(connection, staffId, ticket.ticket_id, 'CALLED_TICKET', servicePointId);

    return {
      ticketId: ticket.ticket_id,
      sequenceNumber: ticket.sequence_number,
      serviceTypeName: ticket.service_type_name,
      attemptNumber: 1
    };
  });
}

export async function recordCallOutcome(
  ticketId: number,
  attemptNumber: number,
  outcome: CallOutcome,
  staffId: number
): Promise<void> {
  assertPositiveInteger(ticketId, 'ticketId');
  assertPositiveInteger(staffId, 'staffId');
  if (attemptNumber !== 1 && attemptNumber !== 2) {
    throw new QueueError('attemptNumber must be 1 or 2');
  }

  await withTransaction(async (connection) => {
    const ticket = await getTicket(connection, ticketId);
    if (ticket.status !== 'CALLED') {
      throw new QueueError('Only a called ticket can have a call outcome recorded');
    }
    const latestAttempt = await assertStaffCanManageTicket(connection, ticketId, staffId);
    if (latestAttempt.attempt_number !== attemptNumber) {
      throw new QueueError('Only the current call attempt can be updated.');
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE call_attempts
       SET outcome = ?
       WHERE ticket_id = ? AND call_round = ? AND attempt_number = ? AND outcome = 'PENDING'`,
      [outcome, ticketId, latestAttempt.call_round, attemptNumber]
    );
    if (result.affectedRows !== 1) {
      throw new QueueError('Call attempt does not exist, is already recorded, or is not pending');
    }
    await recordStaffEvent(
      connection,
      staffId,
      ticketId,
      outcome === 'ACKNOWLEDGED' ? 'CALL_ACKNOWLEDGED' : 'CALL_NO_RESPONSE',
      latestAttempt.service_point_id ?? undefined
    );
  });
}

export async function repeatCall(ticketId: number, staffId: number): Promise<number> {
  assertPositiveInteger(ticketId, 'ticketId');
  assertPositiveInteger(staffId, 'staffId');

  return withTransaction(async (connection) => {
    const ticket = await getTicket(connection, ticketId);
    if (ticket.status !== 'CALLED') {
      throw new QueueError('Only a called ticket can be called again');
    }

    const latestAttempt = await getLatestAttempt(connection, ticketId);
    if (!latestAttempt) {
      throw new QueueError('The ticket has no recorded call attempt.');
    }
    await assertAssignedServicePoint(connection, staffId, latestAttempt.service_point_id ?? 0);
    if (
      latestAttempt?.attempt_number !== 1 ||
      latestAttempt.outcome !== 'NO_RESPONSE'
    ) {
      throw new QueueError('The first call must have no response before it can be repeated');
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO call_attempts
         (ticket_id, call_round, staff_id, service_point_id, attempt_number, called_at)
       VALUES (?, ?, ?, ?, 2, UTC_TIMESTAMP(3))`,
      [ticketId, latestAttempt.call_round, staffId, latestAttempt.service_point_id]
    );

    await recordStaffEvent(
      connection,
      staffId,
      ticketId,
      'REPEATED_CALL',
      latestAttempt.service_point_id ?? undefined
    );
    return result.insertId;
  });
}

export async function markNoShow(ticketId: number, staffId: number): Promise<void> {
  assertPositiveInteger(ticketId, 'ticketId');
  assertPositiveInteger(staffId, 'staffId');

  await withTransaction(async (connection) => {
    const ticket = await getTicket(connection, ticketId);
    const latestAttempt = await getLatestAttempt(connection, ticketId);
    if (!latestAttempt) {
      throw new QueueError('The ticket has no recorded call attempt.');
    }
    await assertAssignedServicePoint(connection, staffId, latestAttempt.service_point_id ?? 0);

    if (
      ticket.status !== 'CALLED' ||
      latestAttempt?.attempt_number !== 2 ||
      latestAttempt.outcome !== 'NO_RESPONSE'
    ) {
      throw new QueueError('A ticket is a no-show only after both calls receive no response');
    }

    await connection.execute(
      "UPDATE queue_tickets SET status = 'NO_SHOW' WHERE ticket_id = ?",
      [ticketId]
    );
    await recordStaffEvent(
      connection,
      staffId,
      ticketId,
      'MARKED_NO_SHOW',
      latestAttempt.service_point_id ?? undefined
    );
  });
}

export async function returnCalledTicketToQueue(ticketId: number, staffId: number): Promise<void> {
  assertPositiveInteger(ticketId, 'ticketId');
  assertPositiveInteger(staffId, 'staffId');

  await withTransaction(async (connection) => {
    const ticket = await getTicket(connection, ticketId);
    if (ticket.status !== 'CALLED') {
      throw new QueueError('Only a called ticket can be returned to the queue.');
    }
    const latestAttempt = await assertStaffCanManageTicket(connection, ticketId, staffId);
    await connection.execute(
      `UPDATE queue_tickets
       SET status = 'WAITING', priority_at = UTC_TIMESTAMP(3)
       WHERE ticket_id = ? AND status = 'CALLED'`,
      [ticketId]
    );
    await recordStaffEvent(
      connection,
      staffId,
      ticketId,
      'TICKET_RETURNED_TO_QUEUE',
      latestAttempt.service_point_id ?? undefined
    );
  });
}

export async function startService(
  ticketId: number,
  servicePointId: number,
  staffId: number
): Promise<void> {
  assertPositiveInteger(ticketId, 'ticketId');
  assertPositiveInteger(servicePointId, 'servicePointId');
  assertPositiveInteger(staffId, 'staffId');

  await withTransaction(async (connection) => {
    const ticket = await getTicket(connection, ticketId);
    const latestAttempt = await getLatestAttempt(connection, ticketId);
    if (
      ticket.status !== 'CALLED' ||
      latestAttempt?.outcome !== 'ACKNOWLEDGED' ||
      latestAttempt.service_point_id !== servicePointId
    ) {
      throw new QueueError('The customer must acknowledge a call at this service point before service starts');
    }
    await assertAssignedServicePoint(connection, staffId, servicePointId);

    await connection.execute(
      "UPDATE queue_tickets SET status = 'IN_SERVICE' WHERE ticket_id = ?",
      [ticketId]
    );
    await connection.execute(
      `INSERT INTO service_records (ticket_id, staff_id, service_point_id, started_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
      [ticketId, staffId, servicePointId]
    );
    await recordStaffEvent(connection, staffId, ticketId, 'SERVICE_STARTED', servicePointId);
  });
}

export async function completeService(ticketId: number, staffId: number): Promise<void> {
  assertPositiveInteger(ticketId, 'ticketId');
  assertPositiveInteger(staffId, 'staffId');

  await withTransaction(async (connection) => {
    const ticket = await getTicket(connection, ticketId);
    if (ticket.status !== 'IN_SERVICE') {
      throw new QueueError('Only a ticket in service can be completed');
    }
    const latestAttempt = await assertStaffCanManageTicket(connection, ticketId, staffId);

    await connection.execute(
      'UPDATE service_records SET completed_at = UTC_TIMESTAMP(3) WHERE ticket_id = ?',
      [ticketId]
    );
    await connection.execute(
      "UPDATE queue_tickets SET status = 'COMPLETED' WHERE ticket_id = ?",
      [ticketId]
    );
    await recordStaffEvent(
      connection,
      staffId,
      ticketId,
      'SERVICE_COMPLETED',
      latestAttempt?.service_point_id ?? undefined
    );
  });
}

export async function getStaffActivity(queueId: number, limit = 30): Promise<StaffAuditEvent[]> {
  assertPositiveInteger(queueId, 'queueId');
  assertPositiveInteger(limit, 'limit');

  const [rows] = await pool.execute<StaffAuditEventRow[]>(
    `SELECT
       e.audit_event_id,
       e.event_type,
       s.display_name AS staff_name,
       t.sequence_number,
       sp.name AS service_point_name,
       e.subject_name,
       e.created_at
     FROM staff_audit_events AS e
     INNER JOIN staff AS s ON s.staff_id = e.staff_id
     LEFT JOIN queue_tickets AS t ON t.ticket_id = e.ticket_id
     LEFT JOIN service_points AS sp ON sp.service_point_id = e.service_point_id
     WHERE (t.queue_id = ? OR (
       e.ticket_id IS NULL AND DATE(e.created_at) = (
         SELECT queue_date FROM daily_queues WHERE queue_id = ?
       )
     ))
     ORDER BY e.created_at DESC, e.audit_event_id DESC
     LIMIT ?`,
    [queueId, queueId, limit]
  );

  return rows.map((row) => ({
    auditEventId: row.audit_event_id,
    eventType: row.event_type,
    staffName: row.staff_name,
    sequenceNumber: row.sequence_number,
    servicePointName: row.service_point_name,
    subjectName: row.subject_name,
    createdAt: row.created_at
  }));
}
