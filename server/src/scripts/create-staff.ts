import 'dotenv/config';
import { createInterface } from 'node:readline';
import { createStaffAccount, validateStaffPassword } from '../models/staff-auth.model.js';
import { pool } from '../db/pool.js';

function askSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal to enter a password safely.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const restoreTerminal = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
    };
    const onData = (data: Buffer) => {
      for (const character of data.toString()) {
        if (character === '\u0003') {
          restoreTerminal();
          process.stdout.write('\n');
          reject(new Error('Account creation cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          restoreTerminal();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (character >= ' ' && character !== '\u007f') {
          value += character;
          process.stdout.write('*');
        }
      }
    };

    process.stdout.write(prompt);
    input.resume();
    input.setRawMode(true);
    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const displayName = await new Promise<string>((resolve) =>
      terminal.question('Staff display name: ', resolve)
    );
    const username = await new Promise<string>((resolve) =>
      terminal.question('Username: ', resolve)
    );
    terminal.close();
    const password = await askSecret('Password (12+ characters): ');
    validateStaffPassword(password);
    const confirmation = await askSecret('Confirm password: ');
    if (password !== confirmation) {
      throw new Error('Passwords do not match.');
    }

    const staffId = await createStaffAccount(displayName, username, password);
    console.log(`Staff sign-in created for ${displayName.trim()} (staff ID ${staffId}).`);
  } finally {
    terminal.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Staff account creation failed.');
  process.exitCode = 1;
});
