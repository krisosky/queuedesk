import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { getAllStaffLoginSeconds, getStaffLoginSeconds } from './staff-hours.model.js';

interface StaffActivityTotalsRow extends RowDataPacket {
  staff_id: number;
  tickets_completed: number;
  no_shows: number;
  tickets_returned: number;
}

interface StaffServicePointTotalsRow extends StaffActivityTotalsRow {
  service_point_id: number;
  service_point_name: string;
}

interface CurrentStaffStationRow extends RowDataPacket {
  staff_id: number;
  service_point_name: string;
}

export interface StaffStats {
  totalLoginSeconds: number;
  ticketsCompleted: number;
  noShows: number;
  ticketsReturned: number;
  byServicePoint: StaffServicePointStats[];
}

export interface StaffServicePointStats {
  servicePointId: number;
  servicePointName: string;
  ticketsCompleted: number;
  noShows: number;
  ticketsReturned: number;
}

export async function getAdminStaffStats(): Promise<
  {
    staffId: number;
    stats: StaffStats;
    currentServiceStations: string[];
  }[]
> {
  const [statsByStaff, stationsByStaff] = await Promise.all([
    getAllStaffStats(),
    getCurrentStaffStations()
  ]);
  return [...statsByStaff.entries()].map(([staffId, stats]) => ({
    staffId,
    stats,
    currentServiceStations: stationsByStaff.get(staffId) ?? []
  }));
}

export async function getCurrentStaffStations(): Promise<Map<number, string[]>> {
  const [rows] = await pool.execute<CurrentStaffStationRow[]>(
    `SELECT session.staff_id, point.name AS service_point_name
     FROM staff_sessions AS session
     INNER JOIN staff_accounts AS account
       ON account.staff_id = session.staff_id AND account.is_active = TRUE
     INNER JOIN staff AS member
       ON member.staff_id = session.staff_id AND member.is_active = TRUE
     INNER JOIN service_points AS point
       ON point.service_point_id = session.active_service_point_id AND point.is_active = TRUE
     INNER JOIN staff_service_points AS assignment
       ON assignment.staff_id = session.staff_id
       AND assignment.service_point_id = point.service_point_id
     WHERE session.ended_at IS NULL
       AND session.expires_at > UTC_TIMESTAMP(3)
     GROUP BY session.staff_id, point.service_point_id, point.name
     ORDER BY point.name`
  );
  const stations = new Map<number, string[]>();
  for (const row of rows) {
    const names = stations.get(row.staff_id) ?? [];
    names.push(row.service_point_name);
    stations.set(row.staff_id, names);
  }
  return stations;
}

export async function getAllStaffStats(): Promise<Map<number, StaffStats>> {
  const [loginSeconds, [rows], [stationRows]] = await Promise.all([
    getAllStaffLoginSeconds(),
    pool.execute<StaffActivityTotalsRow[]>(
      `SELECT
         staff.staff_id,
         COALESCE(SUM(events.event_type = 'SERVICE_COMPLETED'), 0) AS tickets_completed,
         COALESCE(SUM(events.event_type = 'MARKED_NO_SHOW'), 0) AS no_shows,
         COALESCE(SUM(events.event_type = 'TICKET_RETURNED_TO_QUEUE'), 0) AS tickets_returned
       FROM staff
       LEFT JOIN staff_audit_events AS events ON events.staff_id = staff.staff_id
       GROUP BY staff.staff_id`
    ),
    pool.execute<StaffServicePointTotalsRow[]>(
      `SELECT
         events.staff_id,
         point.service_point_id,
         point.name AS service_point_name,
         COALESCE(SUM(events.event_type = 'SERVICE_COMPLETED'), 0) AS tickets_completed,
         COALESCE(SUM(events.event_type = 'MARKED_NO_SHOW'), 0) AS no_shows,
         COALESCE(SUM(events.event_type = 'TICKET_RETURNED_TO_QUEUE'), 0) AS tickets_returned
       FROM staff_audit_events AS events
       INNER JOIN service_points AS point ON point.service_point_id = events.service_point_id
       WHERE events.event_type IN (
         'SERVICE_COMPLETED',
         'MARKED_NO_SHOW',
         'TICKET_RETURNED_TO_QUEUE'
       )
       GROUP BY events.staff_id, point.service_point_id, point.name
       ORDER BY point.name`
    )
  ]);

  const stats = new Map(
    rows.map((row) => [
      row.staff_id,
      {
        totalLoginSeconds: loginSeconds.get(row.staff_id) ?? 0,
        ticketsCompleted: Number(row.tickets_completed ?? 0),
        noShows: Number(row.no_shows ?? 0),
        ticketsReturned: Number(row.tickets_returned ?? 0),
        byServicePoint: [] as StaffServicePointStats[]
      }
    ])
  );

  for (const row of stationRows) {
    stats.get(row.staff_id)?.byServicePoint.push({
      servicePointId: row.service_point_id,
      servicePointName: row.service_point_name,
      ticketsCompleted: Number(row.tickets_completed ?? 0),
      noShows: Number(row.no_shows ?? 0),
      ticketsReturned: Number(row.tickets_returned ?? 0)
    });
  }

  return stats;
}

export async function getStaffStats(staffId: number): Promise<StaffStats> {
  const [loginSeconds, [rows], [stationRows]] = await Promise.all([
    getStaffLoginSeconds(staffId),
    pool.execute<StaffActivityTotalsRow[]>(
      `SELECT
         COALESCE(SUM(event_type = 'SERVICE_COMPLETED'), 0) AS tickets_completed,
         COALESCE(SUM(event_type = 'MARKED_NO_SHOW'), 0) AS no_shows,
         COALESCE(SUM(event_type = 'TICKET_RETURNED_TO_QUEUE'), 0) AS tickets_returned
       FROM staff_audit_events
       WHERE staff_id = ?`,
      [staffId]
    ),
    pool.execute<StaffServicePointTotalsRow[]>(
      `SELECT
         events.staff_id,
         point.service_point_id,
         point.name AS service_point_name,
         COALESCE(SUM(events.event_type = 'SERVICE_COMPLETED'), 0) AS tickets_completed,
         COALESCE(SUM(events.event_type = 'MARKED_NO_SHOW'), 0) AS no_shows,
         COALESCE(SUM(events.event_type = 'TICKET_RETURNED_TO_QUEUE'), 0) AS tickets_returned
       FROM staff_audit_events AS events
       INNER JOIN service_points AS point ON point.service_point_id = events.service_point_id
       WHERE events.staff_id = ?
         AND events.event_type IN (
           'SERVICE_COMPLETED',
           'MARKED_NO_SHOW',
           'TICKET_RETURNED_TO_QUEUE'
         )
       GROUP BY events.staff_id, point.service_point_id, point.name
       ORDER BY point.name`,
      [staffId]
    )
  ]);
  const totals = rows[0];

  return {
    totalLoginSeconds: loginSeconds,
    ticketsCompleted: Number(totals?.tickets_completed ?? 0),
    noShows: Number(totals?.no_shows ?? 0),
    ticketsReturned: Number(totals?.tickets_returned ?? 0),
    byServicePoint: stationRows.map((row) => ({
      servicePointId: row.service_point_id,
      servicePointName: row.service_point_name,
      ticketsCompleted: Number(row.tickets_completed ?? 0),
      noShows: Number(row.no_shows ?? 0),
      ticketsReturned: Number(row.tickets_returned ?? 0)
    }))
  };
}
