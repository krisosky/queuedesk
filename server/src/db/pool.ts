import 'dotenv/config';
import mysql, { type PoolConnection } from 'mysql2/promise';

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function positiveIntegerEnvironmentVariable(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedValue;
}

export const pool = mysql.createPool({
  host: requiredEnvironmentVariable('DB_HOST'),
  port: positiveIntegerEnvironmentVariable('DB_PORT', 3306),
  user: requiredEnvironmentVariable('DB_USER'),
  password: requiredEnvironmentVariable('DB_PASSWORD'),
  database: requiredEnvironmentVariable('DB_NAME'),
  connectionLimit: positiveIntegerEnvironmentVariable('DB_CONNECTION_LIMIT', 10),
  waitForConnections: true,
  timezone: 'Z',
  decimalNumbers: true
});

export async function withTransaction<T>(
  operation: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'The database operation failed and its transaction could not be rolled back'
      );
    }

    throw error;
  } finally {
    connection.release();
  }
}
