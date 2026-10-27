import 'dotenv/config';
import { createApp } from './app.js';
import { pool } from './db/pool.js';

function positiveIntegerEnvironmentVariable(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0 || parsedValue > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return parsedValue;
}

const host = process.env.API_HOST ?? '127.0.0.1';
const port = positiveIntegerEnvironmentVariable('API_PORT', 3000);
const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`Queue API listening on http://${host}:${port}`);
});

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down queue API`);
  server.close((serverError) => {
    void pool.end().then(
      () => {
        if (serverError) {
          console.error('HTTP server shutdown failed', serverError);
          process.exitCode = 1;
        }
      },
      (databaseError: unknown) => {
        console.error('Database pool shutdown failed', databaseError);
        process.exitCode = 1;
      }
    );
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
