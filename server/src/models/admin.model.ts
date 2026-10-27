import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, withTransaction } from '../db/pool.js';
import { QueueError } from './queue.model.js';
import {
  getTicketPrintingEnabled,
  setTicketPrintingEnabled
} from './app-settings.model.js';
import {
  getAllStaffStats,
  getCurrentStaffStations,
  type StaffStats
} from './staff-stats.model.js';
import {
  createStaffAccount,
  validateStaffPassword,
  validateStaffUsername
} from './staff-auth.model.js';

export interface AdminService {
  serviceTypeId: number;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface AdminServicePoint {
  servicePointId: number;
  name: string;
  isActive: boolean;
  serviceTypeIds: number[];
}

export interface AdminStaffAccount {
  staffId: number;
  displayName: string;
  username: string | null;
  role: 'ADMIN' | 'STAFF' | null;
  isActive: boolean;
  hasAccount: boolean;
  servicePointIds: number[];
  stats: StaffStats;
  currentServiceStations: string[];
}

export interface AdminConfiguration {
  services: AdminService[];
  servicePoints: AdminServicePoint[];
  staff: AdminStaffAccount[];
  ticketPrintingEnabled: boolean;
}

interface ServiceRow extends RowDataPacket {
  service_type_id: number;
  name: string;
  description: string | null;
  is_active: number;
}

interface PointRow extends RowDataPacket {
  service_point_id: number;
  name: string;
  is_active: number;
  service_type_id: number | null;
}

interface StaffRow extends RowDataPacket {
  staff_id: number;
  display_name: string;
  username: string | null;
  role: 'ADMIN' | 'STAFF' | null;
  staff_is_active: number;
  account_is_active: number | null;
  service_point_id: number | null;
}

async function recordAdminEvent(
  connection: import('mysql2/promise').PoolConnection,
  staffId: number,
  eventType:
    | 'SERVICE_CREATED'
    | 'SERVICE_UPDATED'
    | 'SERVICE_POINT_CREATED'
    | 'SERVICE_POINT_UPDATED'
    | 'SERVICE_POINT_SERVICES_UPDATED'
    | 'STAFF_ACCOUNT_UPDATED',
  subjectName: string
): Promise<void> {
  await connection.execute(
    `INSERT INTO staff_audit_events
       (staff_id, ticket_id, service_point_id, event_type, subject_name, created_at)
     VALUES (?, NULL, NULL, ?, ?, UTC_TIMESTAMP(3))`,
    [staffId, eventType, subjectName]
  );
}

async function ensureActiveServicesRouted(
  connection: import('mysql2/promise').PoolConnection
): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT st.name
     FROM service_types AS st
     WHERE st.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1
         FROM service_point_service_types AS mapping
         INNER JOIN service_points AS point
           ON point.service_point_id = mapping.service_point_id AND point.is_active = TRUE
         WHERE mapping.service_type_id = st.service_type_id
       )
     LIMIT 1`
  );
  const unroutedService = rows[0];
  if (unroutedService) {
    throw new QueueError(
      `Cannot apply this change: active service "${String(unroutedService.name)}" would have no active service point. Map it to another active point or deactivate the service first.`
    );
  }
}

export async function getAdminConfiguration(): Promise<AdminConfiguration> {
  const [services, points, staff, staffStats, currentStations, ticketPrintingEnabled] = await Promise.all([
    pool.execute<ServiceRow[]>(
      `SELECT service_type_id, name, description, is_active
       FROM service_types ORDER BY name`
    ),
    pool.execute<PointRow[]>(
      `SELECT point.service_point_id, point.name, point.is_active, mapping.service_type_id
       FROM service_points AS point
       LEFT JOIN service_point_service_types AS mapping
         ON mapping.service_point_id = point.service_point_id
       ORDER BY point.name, mapping.service_type_id`
    ),
    pool.execute<StaffRow[]>(
      `SELECT staff.staff_id, staff.display_name, account.username, account.role,
              staff.is_active AS staff_is_active, account.is_active AS account_is_active,
              assignment.service_point_id
       FROM staff
       LEFT JOIN staff_accounts AS account ON account.staff_id = staff.staff_id
       LEFT JOIN staff_service_points AS assignment ON assignment.staff_id = staff.staff_id
       ORDER BY staff.display_name`
    ),
    getAllStaffStats(),
    getCurrentStaffStations(),
    getTicketPrintingEnabled()
  ]);

  const pointMap = new Map<number, AdminServicePoint>();
  for (const row of points[0]) {
    let point = pointMap.get(row.service_point_id);
    if (!point) {
      point = {
        servicePointId: row.service_point_id,
        name: row.name,
        isActive: Boolean(row.is_active),
        serviceTypeIds: []
      };
      pointMap.set(row.service_point_id, point);
    }
    if (row.service_type_id !== null) {
      point.serviceTypeIds.push(row.service_type_id);
    }
  }

  const staffMap = new Map<number, AdminStaffAccount>();
  for (const row of staff[0]) {
    let account = staffMap.get(row.staff_id);
    if (!account) {
      account = {
        staffId: row.staff_id,
        displayName: row.display_name,
        username: row.username,
        role: row.role,
        isActive:
          Boolean(row.staff_is_active) &&
          (row.account_is_active === null || Boolean(row.account_is_active)),
        hasAccount: row.username !== null,
        servicePointIds: [],
        currentServiceStations: currentStations.get(row.staff_id) ?? [],
        stats: staffStats.get(row.staff_id) ?? {
          totalLoginSeconds: 0,
          ticketsCompleted: 0,
          noShows: 0,
          ticketsReturned: 0,
          byServicePoint: []
        }
      };
      staffMap.set(row.staff_id, account);
    }
    if (row.service_point_id !== null) {
      account.servicePointIds.push(row.service_point_id);
    }
  }

  return {
    services: services[0].map((row) => ({
      serviceTypeId: row.service_type_id,
      name: row.name,
      description: row.description,
      isActive: Boolean(row.is_active)
    })),
    servicePoints: [...pointMap.values()],
    staff: [...staffMap.values()],
    ticketPrintingEnabled
  };
}

export async function updateTicketPrintingEnabled(enabled: boolean): Promise<void> {
  await setTicketPrintingEnabled(enabled);
}

export async function createService(
  actorStaffId: number,
  name: string,
  description: string | null
): Promise<number> {
  return withTransaction(async (connection) => {
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO service_types (name, description, is_active, created_at)
       VALUES (?, ?, TRUE, UTC_TIMESTAMP(3))`,
      [name, description]
    );
    await recordAdminEvent(connection, actorStaffId, 'SERVICE_CREATED', name);
    return insert.insertId;
  });
}

export async function updateService(
  actorStaffId: number,
  serviceTypeId: number,
  name: string,
  description: string | null,
  isActive: boolean
): Promise<void> {
  await withTransaction(async (connection) => {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE service_types SET name = ?, description = ?, is_active = ?
       WHERE service_type_id = ?`,
      [name, description, isActive, serviceTypeId]
    );
    if (result.affectedRows !== 1) {
      throw new QueueError('Service was not found.');
    }
    if (isActive) {
      await ensureActiveServicesRouted(connection);
    }
    await recordAdminEvent(connection, actorStaffId, 'SERVICE_UPDATED', name);
  });
}

export async function createServicePoint(actorStaffId: number, name: string): Promise<number> {
  return withTransaction(async (connection) => {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO service_points (name, is_active, created_at)
       VALUES (?, TRUE, UTC_TIMESTAMP(3))`,
      [name]
    );
    await recordAdminEvent(connection, actorStaffId, 'SERVICE_POINT_CREATED', name);
    return result.insertId;
  });
}

export async function updateServicePoint(
  actorStaffId: number,
  servicePointId: number,
  name: string,
  isActive: boolean
): Promise<void> {
  await withTransaction(async (connection) => {
    if (!isActive) {
      const [activeTickets] = await connection.execute<RowDataPacket[]>(
        `SELECT ticket.ticket_id
         FROM queue_tickets AS ticket
         WHERE ticket.status IN ('CALLED', 'IN_SERVICE')
           AND ticket.ticket_id IN (
             SELECT ticket_id FROM call_attempts WHERE service_point_id = ?
             UNION
             SELECT ticket_id FROM service_records WHERE service_point_id = ?
           )
         LIMIT 1 FOR UPDATE`,
        [servicePointId, servicePointId]
      );
      if (activeTickets.length > 0) {
        throw new QueueError('Finish the customer currently at this service point before deactivating it.');
      }
    }
    const [result] = await connection.execute<ResultSetHeader>(
      'UPDATE service_points SET name = ?, is_active = ? WHERE service_point_id = ?',
      [name, isActive, servicePointId]
    );
    if (result.affectedRows !== 1) {
      throw new QueueError('Service point was not found.');
    }
    await ensureActiveServicesRouted(connection);
    await recordAdminEvent(connection, actorStaffId, 'SERVICE_POINT_UPDATED', name);
  });
}

export async function updateServicePointServices(
  actorStaffId: number,
  servicePointId: number,
  serviceTypeIds: number[]
): Promise<void> {
  await withTransaction(async (connection) => {
    const [points] = await connection.execute<RowDataPacket[]>(
      'SELECT name FROM service_points WHERE service_point_id = ? AND is_active = TRUE FOR UPDATE',
      [servicePointId]
    );
    const point = points[0];
    if (!point) {
      throw new QueueError('An active service point is required to update its services.');
    }
    if (serviceTypeIds.length > 0) {
      const placeholders = serviceTypeIds.map(() => '?').join(', ');
      const [services] = await connection.execute<RowDataPacket[]>(
        `SELECT service_type_id FROM service_types
         WHERE is_active = TRUE AND service_type_id IN (${placeholders})`,
        serviceTypeIds
      );
      if (services.length !== serviceTypeIds.length) {
        throw new QueueError('Choose only active services.');
      }
    }

    await connection.execute(
      'DELETE FROM service_point_service_types WHERE service_point_id = ?',
      [servicePointId]
    );
    for (const serviceTypeId of serviceTypeIds) {
      await connection.execute(
        'INSERT INTO service_point_service_types (service_point_id, service_type_id) VALUES (?, ?)',
        [servicePointId, serviceTypeId]
      );
    }
    await ensureActiveServicesRouted(connection);
    await recordAdminEvent(
      connection,
      actorStaffId,
      'SERVICE_POINT_SERVICES_UPDATED',
      String(point.name)
    );
  });
}

export async function createManagedStaffAccount(
  actorStaffId: number,
  displayName: string,
  username: string,
  password: string,
  role: 'ADMIN' | 'STAFF',
  servicePointIds: number[]
): Promise<number> {
  if (servicePointIds.length === 0) {
    throw new QueueError('Assign at least one active service station to the new staff account.');
  }
  return createStaffAccount(displayName, username, password, role, actorStaffId, servicePointIds);
}

export async function updateManagedStaffAccount(
  actorStaffId: number,
  staffId: number,
  displayName: string,
  username: string,
  isActive: boolean,
  role: 'ADMIN' | 'STAFF',
  servicePointIds: number[]
): Promise<void> {
  if (new Set(servicePointIds).size !== servicePointIds.length) {
    throw new QueueError('Service station assignments must not contain duplicates.');
  }
  if (servicePointIds.length === 0) {
    throw new QueueError('An active staff account must be assigned to at least one service station.');
  }
  await withTransaction(async (connection) => {
    const [accounts] = await connection.execute<RowDataPacket[]>(
      `SELECT account.staff_id, account.username, account.role, account.is_active, staff.display_name,
              staff.is_active AS staff_is_active
       FROM staff_accounts AS account
       INNER JOIN staff ON staff.staff_id = account.staff_id
       WHERE account.staff_id = ? FOR UPDATE`,
      [staffId]
    );
    const account = accounts[0];
    if (!account) {
      throw new QueueError('Staff account was not found.');
    }

    const [usernameOwners] = await connection.execute<RowDataPacket[]>(
      'SELECT staff_id FROM staff_accounts WHERE username = ? AND staff_id <> ? FOR UPDATE',
      [username, staffId]
    );
    if (usernameOwners.length) {
      throw new QueueError('That username is already in use.');
    }

    if (servicePointIds.length > 0) {
      const [points] = await connection.execute<
        (RowDataPacket & { service_point_id: number; is_active: number })[]
      >(
        `SELECT service_point_id, is_active
         FROM service_points
         WHERE service_point_id IN (${servicePointIds.map(() => '?').join(',')})
         FOR UPDATE`,
        servicePointIds
      );
      if (points.length !== servicePointIds.length) {
        throw new QueueError('One or more assigned service stations no longer exist.');
      }
      const [existingAssignments] = await connection.execute<
        (RowDataPacket & { service_point_id: number })[]
      >(
        'SELECT service_point_id FROM staff_service_points WHERE staff_id = ? FOR UPDATE',
        [staffId]
      );
      const existingStationIds = new Set(
        existingAssignments.map((assignment) => assignment.service_point_id)
      );
      if (
        points.some(
          (point) => !Boolean(point.is_active) && !existingStationIds.has(point.service_point_id)
        )
      ) {
        throw new QueueError('New assignments can only be made to active service stations.');
      }
    }
    const [activeAssignments] = await connection.execute<RowDataPacket[]>(
      `SELECT DISTINCT COALESCE(service_records.service_point_id, current_call.service_point_id) AS service_point_id
       FROM queue_tickets
       LEFT JOIN call_attempts AS current_call
         ON current_call.call_attempt_id = (
           SELECT latest.call_attempt_id
           FROM call_attempts AS latest
           WHERE latest.ticket_id = queue_tickets.ticket_id
           ORDER BY latest.call_round DESC, latest.attempt_number DESC
           LIMIT 1
         )
       LEFT JOIN service_records ON service_records.ticket_id = queue_tickets.ticket_id
       WHERE queue_tickets.status IN ('CALLED', 'IN_SERVICE')
         AND (
           current_call.staff_id = ? OR service_records.staff_id = ?
         )`,
      [staffId, staffId]
    );
    if (
      activeAssignments.some(
        (assignment) =>
          !isActive || !servicePointIds.includes(Number(assignment.service_point_id))
      )
    ) {
      throw new QueueError('Finish this staff member’s active customer before disabling access or removing its station assignment.');
    }

    if (actorStaffId === staffId && (!isActive || role !== 'ADMIN')) {
      throw new QueueError('You cannot deactivate or remove administrator access from your own account.');
    }
    const currentlyAdmin = account.role === 'ADMIN' &&
      Boolean(account.is_active) &&
      Boolean(account.staff_is_active);
    if (currentlyAdmin && (!isActive || role !== 'ADMIN')) {
      const [admins] = await connection.execute<RowDataPacket[]>(
        `SELECT staff_id FROM staff_accounts
         WHERE role = 'ADMIN' AND is_active = TRUE AND staff_id <> ?
         LIMIT 1 FOR UPDATE`,
        [staffId]
      );
      if (admins.length === 0) {
        throw new QueueError('The last active administrator cannot be deactivated or changed to staff.');
      }
    }

    await connection.execute(
      'UPDATE staff SET display_name = ?, is_active = ? WHERE staff_id = ?',
      [displayName, isActive, staffId]
    );
    await connection.execute(
      'UPDATE staff_accounts SET username = ?, role = ?, is_active = ? WHERE staff_id = ?',
      [username, role, isActive, staffId]
    );
    await connection.execute('DELETE FROM staff_service_points WHERE staff_id = ?', [staffId]);
    for (const servicePointId of servicePointIds) {
      await connection.execute(
        `INSERT INTO staff_service_points (staff_id, service_point_id, created_at)
         VALUES (?, ?, UTC_TIMESTAMP(3))`,
        [staffId, servicePointId]
      );
    }
    await recordAdminEvent(connection, actorStaffId, 'STAFF_ACCOUNT_UPDATED', displayName);
  });
}

export function validateAdminServiceInput(
  name: string,
  description: string | null
): { name: string; description: string | null } {
  const cleanName = name.trim();
  const cleanDescription = description?.trim() || null;
  if (!cleanName || cleanName.length > 100) {
    throw new Error('Service name must be between 1 and 100 characters.');
  }
  if (cleanDescription && cleanDescription.length > 255) {
    throw new Error('Service description must be 255 characters or fewer.');
  }
  return { name: cleanName, description: cleanDescription };
}

export function validateAdminServicePointName(name: string): string {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 100) {
    throw new Error('Service point name must be between 1 and 100 characters.');
  }
  return cleanName;
}

export function validateManagedUsername(username: string): string {
  return validateStaffUsername(username);
}

export function validateManagedPassword(password: string): void {
  validateStaffPassword(password);
}
