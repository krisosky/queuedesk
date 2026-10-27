import 'dotenv/config';
import { pool } from '../db/pool.js';
import { promoteStaffAccountToAdmin } from '../models/staff-auth.model.js';

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    throw new Error('Provide the username of the existing active staff account.');
  }
  try {
    await promoteStaffAccountToAdmin(username);
    console.log(`Administrator access granted to ${username.trim()}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not promote staff account.');
  process.exitCode = 1;
});
