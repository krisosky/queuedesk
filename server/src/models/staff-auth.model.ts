import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, withTransaction } from '../db/pool.js';

const PASSWORD_KEY_LENGTH = 64;
const SESSION_DURATION_HOURS = 12;

export interface AuthenticatedStaff {
  staffId: number;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'STAFF';
}

interface StaffAccountRow extends RowDataPacket {
  staff_id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: 'ADMIN' | 'STAFF';
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, PASSWORD_KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

export async function hashStaffPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyStaffPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey] =
    encodedHash.split('$');
  if (
    algorithm !== 'scrypt' ||
    cost !== '16384' ||
    blockSize !== '8' ||
    parallelization !== '1' ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false;
  }

  const expectedKey = Buffer.from(encodedKey, 'base64url');
  if (expectedKey.length !== PASSWORD_KEY_LENGTH) {
    return false;
  }

  const actualKey = await deriveKey(password, Buffer.from(encodedSalt, 'base64url'));
  return timingSafeEqual(actualKey, expectedKey);
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function validateStaffUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) {
    throw new Error('Username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens.');
  }
  return normalized;
}

export function validateStaffPassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters.');
  }
}

export async function createStaffAccount(
  displayName: string,
  username: string,
  password: string,
  role: 'ADMIN' | 'STAFF' = 'STAFF',
  createdByStaffId?: number,
  servicePointIds: number[] = []
): Promise<number> {
  const normalizedDisplayName = displayName.trim();
  if (normalizedDisplayName.length < 1 || normalizedDisplayName.length > 100) {
    throw new Error('Display name must be between 1 and 100 characters.');
  }
  const normalizedUsername = validateStaffUsername(username);
  validateStaffPassword(password);
  if (new Set(servicePointIds).size !== servicePointIds.length) {
    throw new Error('Service station assignments must not contain duplicates.');
  }
  const passwordHash = await hashStaffPassword(password);

  return withTransaction(async (connection) => {
    const [existingStaff] = await connection.execute<
      (RowDataPacket & { staff_id: number })[]
    >(
      'SELECT staff_id FROM staff WHERE display_name = ? AND is_active = TRUE FOR UPDATE',
      [normalizedDisplayName]
    );
    if (existingStaff.length > 1) {
      throw new Error('More than one active staff record has this display name; resolve the duplicate before creating an account.');
    }

    let staffId = existingStaff[0]?.staff_id;
    if (staffId === undefined) {
      const [staffResult] = await connection.execute<ResultSetHeader>(
        'INSERT INTO staff (display_name, is_active, created_at) VALUES (?, TRUE, UTC_TIMESTAMP(3))',
        [normalizedDisplayName]
      );
      staffId = staffResult.insertId;
    } else {
      const [accounts] = await connection.execute<RowDataPacket[]>(
        'SELECT staff_id FROM staff_accounts WHERE staff_id = ? LIMIT 1',
        [staffId]
      );
      if (accounts.length > 0) {
        throw new Error('This staff member already has a sign-in account.');
      }
    }

    await connection.execute(
      `INSERT INTO staff_accounts (staff_id, username, password_hash, role, is_active, created_at)
       VALUES (?, ?, ?, ?, TRUE, UTC_TIMESTAMP(3))`,
      [staffId, normalizedUsername, passwordHash, role]
    );
    if (servicePointIds.length > 0) {
      const [activePoints] = await connection.execute<RowDataPacket[]>(
        `SELECT service_point_id
         FROM service_points
         WHERE is_active = TRUE AND service_point_id IN (${servicePointIds.map(() => '?').join(',')})
         FOR UPDATE`,
        servicePointIds
      );
      if (activePoints.length !== servicePointIds.length) {
        throw new Error('Choose only active service stations.');
      }
      for (const servicePointId of servicePointIds) {
        await connection.execute(
          `INSERT INTO staff_service_points (staff_id, service_point_id, created_at)
           VALUES (?, ?, UTC_TIMESTAMP(3))`,
          [staffId, servicePointId]
        );
      }
    }
    if (createdByStaffId !== undefined) {
      await connection.execute(
        `INSERT INTO staff_audit_events
           (staff_id, ticket_id, service_point_id, event_type, subject_name, created_at)
         VALUES (?, NULL, NULL, 'STAFF_ACCOUNT_CREATED', ?, UTC_TIMESTAMP(3))`,
        [createdByStaffId, normalizedDisplayName]
      );
    }
    return staffId;
  });
}

export async function loginStaff(
  username: string,
  password: string
): Promise<{ token: string; staff: AuthenticatedStaff; expiresAt: Date } | null> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || password.length === 0 || password.length > 128) {
    return null;
  }

  const [rows] = await pool.execute<StaffAccountRow[]>(
    `    SELECT a.staff_id, a.username, s.display_name, a.password_hash, a.role
     FROM staff_accounts AS a
     INNER JOIN staff AS s ON s.staff_id = a.staff_id
     WHERE a.username = ? AND a.is_active = TRUE AND s.is_active = TRUE
     LIMIT 1`,
    [normalizedUsername]
  );
  const account = rows[0];
  if (!account || !(await verifyStaffPassword(password, account.password_hash))) {
    return null;
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
  await pool.execute(
    `UPDATE staff_sessions
     SET ended_at = expires_at, end_reason = 'EXPIRED'
     WHERE ended_at IS NULL AND expires_at <= UTC_TIMESTAMP(3)`
  );
  await pool.execute(
    `INSERT INTO staff_sessions (token_hash, staff_id, expires_at, created_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
    [hashSessionToken(token), account.staff_id, expiresAt]
  );

  return {
    token,
    staff: {
      staffId: account.staff_id,
      username: account.username,
      displayName: account.display_name,
      role: account.role
    },
    expiresAt
  };
}

export async function getStaffForSession(token: string): Promise<AuthenticatedStaff | null> {
  const [rows] = await pool.execute<StaffAccountRow[]>(
    `    SELECT a.staff_id, a.username, s.display_name, a.password_hash, a.role
     FROM staff_sessions AS session
     INNER JOIN staff_accounts AS a ON a.staff_id = session.staff_id AND a.is_active = TRUE
     INNER JOIN staff AS s ON s.staff_id = a.staff_id AND s.is_active = TRUE
     WHERE session.token_hash = ?
       AND session.ended_at IS NULL
       AND session.expires_at > UTC_TIMESTAMP(3)
     LIMIT 1`,
    [hashSessionToken(token)]
  );
  const account = rows[0];
  return account
    ? {
        staffId: account.staff_id,
        username: account.username,
        displayName: account.display_name,
        role: account.role
      }
    : null;
}

export async function logoutStaff(token: string): Promise<void> {
  await pool.execute(
    `UPDATE staff_sessions
     SET ended_at = LEAST(UTC_TIMESTAMP(3), expires_at),
         end_reason = IF(expires_at <= UTC_TIMESTAMP(3), 'EXPIRED', 'LOGOUT')
     WHERE token_hash = ? AND ended_at IS NULL`,
    [hashSessionToken(token)]
  );
}

export async function setStaffSessionServicePoint(
  token: string,
  staffId: number,
  servicePointId: number
): Promise<boolean> {
  return withTransaction(async (connection) => {
    const [assignments] = await connection.execute<RowDataPacket[]>(
      `SELECT assignment.service_point_id
       FROM staff_service_points AS assignment
       INNER JOIN service_points AS point
         ON point.service_point_id = assignment.service_point_id
       WHERE assignment.staff_id = ?
         AND assignment.service_point_id = ?
         AND point.is_active = TRUE
       FOR UPDATE`,
      [staffId, servicePointId]
    );
    if (assignments.length === 0) {
      return false;
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE staff_sessions
       SET active_service_point_id = ?, station_updated_at = UTC_TIMESTAMP(3)
       WHERE token_hash = ?
         AND staff_id = ?
         AND ended_at IS NULL
         AND expires_at > UTC_TIMESTAMP(3)`,
      [servicePointId, hashSessionToken(token), staffId]
    );
    return result.affectedRows === 1;
  });
}

export async function getStaffSessionServicePoint(
  token: string,
  staffId: number
): Promise<number | null> {
  const [rows] = await pool.execute<
    (RowDataPacket & { active_service_point_id: number })[]
  >(
    `SELECT session.active_service_point_id
     FROM staff_sessions AS session
     INNER JOIN staff_service_points AS assignment
       ON assignment.staff_id = session.staff_id
       AND assignment.service_point_id = session.active_service_point_id
     INNER JOIN service_points AS point
       ON point.service_point_id = session.active_service_point_id
       AND point.is_active = TRUE
     WHERE session.token_hash = ?
       AND session.staff_id = ?
       AND session.ended_at IS NULL
       AND session.expires_at > UTC_TIMESTAMP(3)
     LIMIT 1`,
    [hashSessionToken(token), staffId]
  );
  return rows[0]?.active_service_point_id ?? null;
}

export async function promoteStaffAccountToAdmin(username: string): Promise<void> {
  const normalizedUsername = validateStaffUsername(username);
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE staff_accounts
     SET role = 'ADMIN'
     WHERE username = ? AND is_active = TRUE`,
    [normalizedUsername]
  );
  if (result.affectedRows !== 1) {
    throw new Error('No active staff account matched that username.');
  }
}
