import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';

interface AppSettingRow extends RowDataPacket {
  setting_value: string;
}

const TICKET_PRINTING_SETTING = 'ticket_printing_enabled';

export async function getTicketPrintingEnabled(): Promise<boolean> {
  const [rows] = await pool.execute<AppSettingRow[]>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    [TICKET_PRINTING_SETTING]
  );
  return rows[0]?.setting_value === 'true';
}

export async function setTicketPrintingEnabled(enabled: boolean): Promise<void> {
  await pool.execute(
    `INSERT INTO app_settings (setting_key, setting_value, updated_at)
     VALUES (?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       setting_value = VALUES(setting_value),
       updated_at = UTC_TIMESTAMP(3)`,
    [TICKET_PRINTING_SETTING, String(enabled)]
  );
}
