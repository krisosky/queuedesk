import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';

interface StaffLoginDurationRow extends RowDataPacket {
  staff_id: number;
  total_seconds: number;
}

const durationExpression = `GREATEST(
  0,
  TIMESTAMPDIFF(
    SECOND,
    session.created_at,
    LEAST(
      COALESCE(session.ended_at, UTC_TIMESTAMP(3)),
      session.expires_at,
      DATE_ADD(session.created_at, INTERVAL 12 HOUR)
    )
  )
)`;

export async function getStaffLoginSeconds(staffId: number): Promise<number> {
  const [rows] = await pool.execute<StaffLoginDurationRow[]>(
    `SELECT ? AS staff_id,
            COALESCE(SUM(${durationExpression}), 0) AS total_seconds
     FROM staff_sessions AS session
     WHERE session.staff_id = ?`,
    [staffId, staffId]
  );
  return Number(rows[0]?.total_seconds ?? 0);
}

export async function getAllStaffLoginSeconds(): Promise<Map<number, number>> {
  const [rows] = await pool.execute<StaffLoginDurationRow[]>(
    `SELECT staff.staff_id,
            COALESCE(SUM(${durationExpression}), 0) AS total_seconds
     FROM staff
     LEFT JOIN staff_sessions AS session ON session.staff_id = staff.staff_id
     GROUP BY staff.staff_id`
  );
  return new Map(rows.map((row) => [row.staff_id, Number(row.total_seconds)]));
}
