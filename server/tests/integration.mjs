import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const testDatabase = process.env.TEST_DB_NAME;
if (!testDatabase || !/_test$/i.test(testDatabase)) {
  throw new Error('Set TEST_DB_NAME to a dedicated database name ending in _test.');
}
if (testDatabase === process.env.DB_NAME) {
  throw new Error('TEST_DB_NAME must differ from DB_NAME; refusing to run against the application database.');
}
process.env.DB_NAME = testDatabase;

const [{ createApp }, { pool }, { hashStaffPassword }] = await Promise.all([
  import('../dist/app.js'),
  import('../dist/db/pool.js'),
  import('../dist/models/staff-auth.model.js')
]);

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const prefix = `it_${suffix}`;
const created = {
  serviceTypes: [],
  servicePoints: [],
  staff: [],
  queueId: null,
  eventIds: [],
  ticketPrintingSetting: false
};
let server;
let poolClosed = false;

async function request(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (cookie) {
    headers.Cookie = cookie;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    response,
    json: response.status === 204 ? null : await response.json()
  };
}

function sessionCookie(response) {
  const value = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(value, 'login should set a session cookie');
  return value;
}

async function createStaff(displayName, username, role, stationIds, passwordHash) {
  const [result] = await pool.execute(
    'INSERT INTO staff (display_name, is_active, created_at) VALUES (?, TRUE, UTC_TIMESTAMP(3))',
    [displayName]
  );
  const staffId = result.insertId;
  created.staff.push(staffId);
  await pool.execute(
    `INSERT INTO staff_accounts
       (staff_id, username, password_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, TRUE, UTC_TIMESTAMP(3))`,
    [staffId, username, passwordHash, role]
  );
  for (const stationId of stationIds) {
    await pool.execute(
      `INSERT INTO staff_service_points (staff_id, service_point_id, created_at)
       VALUES (?, ?, UTC_TIMESTAMP(3))`,
      [staffId, stationId]
    );
  }
  return staffId;
}

async function cleanup() {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (poolClosed) {
    return;
  }

  try {
    if (created.ticketPrintingSetting) {
      await pool.execute(
        `UPDATE app_settings
         SET setting_value = 'false', updated_at = UTC_TIMESTAMP(3)
         WHERE setting_key = 'ticket_printing_enabled'`
      );
    }
    if (created.queueId !== null) {
      await pool.execute(
        `DELETE FROM staff_audit_events
         WHERE ticket_id IN (SELECT ticket_id FROM queue_tickets WHERE queue_id = ?)
            OR audit_event_id IN (${created.eventIds.length ? created.eventIds.map(() => '?').join(',') : 'NULL'})`,
        [created.queueId, ...created.eventIds]
      );
      await pool.execute(
        `DELETE FROM service_records
         WHERE ticket_id IN (SELECT ticket_id FROM queue_tickets WHERE queue_id = ?)`,
        [created.queueId]
      );
      await pool.execute(
        `DELETE FROM call_attempts
         WHERE ticket_id IN (SELECT ticket_id FROM queue_tickets WHERE queue_id = ?)`,
        [created.queueId]
      );
      await pool.execute('DELETE FROM queue_tickets WHERE queue_id = ?', [created.queueId]);
      await pool.execute('DELETE FROM daily_queues WHERE queue_id = ?', [created.queueId]);
    } else if (created.eventIds.length) {
      await pool.execute(
        `DELETE FROM staff_audit_events
         WHERE audit_event_id IN (${created.eventIds.map(() => '?').join(',')})`,
        created.eventIds
      );
    }

    if (created.staff.length) {
      const placeholders = created.staff.map(() => '?').join(',');
      await pool.execute(`DELETE FROM staff_sessions WHERE staff_id IN (${placeholders})`, created.staff);
      await pool.execute(
        `DELETE FROM staff_audit_events WHERE staff_id IN (${placeholders})`,
        created.staff
      );
      await pool.execute(
        `DELETE FROM staff_service_points WHERE staff_id IN (${placeholders})`,
        created.staff
      );
      await pool.execute(
        `DELETE FROM staff_accounts WHERE staff_id IN (${placeholders})`,
        created.staff
      );
      await pool.execute(`DELETE FROM staff WHERE staff_id IN (${placeholders})`, created.staff);
    }
    if (created.servicePoints.length) {
      const placeholders = created.servicePoints.map(() => '?').join(',');
      await pool.execute(
        `DELETE FROM service_point_service_types WHERE service_point_id IN (${placeholders})`,
        created.servicePoints
      );
      await pool.execute(
        `DELETE FROM service_points WHERE service_point_id IN (${placeholders})`,
        created.servicePoints
      );
    }
    if (created.serviceTypes.length) {
      await pool.execute(
        `DELETE FROM service_types WHERE service_type_id IN (${created.serviceTypes.map(() => '?').join(',')})`,
        created.serviceTypes
      );
    }
  } finally {
    await pool.end();
    poolClosed = true;
  }
}

try {
  const [columns] = await pool.execute("SHOW COLUMNS FROM staff_sessions LIKE 'active_service_point_id'");
  assert.equal(columns.length, 1, 'test database must have schema through migration 008');
  const [settingsTable] = await pool.execute("SHOW TABLES LIKE 'app_settings'");
  assert.equal(settingsTable.length, 1, 'test database must have schema through migration 009');
  const [printingSettings] = await pool.execute(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'ticket_printing_enabled'"
  );
  assert.equal(printingSettings[0]?.setting_value, 'false', 'ticket printing should default off');
  created.ticketPrintingSetting = true;

  for (const name of [`${prefix}_service_a`, `${prefix}_service_b`]) {
    const [result] = await pool.execute(
      'INSERT INTO service_types (name, is_active, created_at) VALUES (?, TRUE, UTC_TIMESTAMP(3))',
      [name]
    );
    created.serviceTypes.push(result.insertId);
  }

  for (const name of [`${prefix}_station_a`, `${prefix}_station_b`]) {
    const [result] = await pool.execute(
      'INSERT INTO service_points (name, is_active, created_at) VALUES (?, TRUE, UTC_TIMESTAMP(3))',
      [name]
    );
    created.servicePoints.push(result.insertId);
  }
  await pool.execute(
    'INSERT INTO service_point_service_types (service_point_id, service_type_id) VALUES (?, ?), (?, ?)',
    [
      created.servicePoints[0],
      created.serviceTypes[0],
      created.servicePoints[1],
      created.serviceTypes[1]
    ]
  );

  const password = `Test-${randomUUID()}-Password`;
  const passwordHash = await hashStaffPassword(password);
  await createStaff(
    `${prefix} operator`,
    `${prefix}_operator`,
    'STAFF',
    [created.servicePoints[0]],
    passwordHash
  );
  await createStaff(
    `${prefix} admin`,
    `${prefix}_admin`,
    'ADMIN',
    created.servicePoints,
    passwordHash
  );

  const [queue] = await pool.execute(
    `INSERT INTO daily_queues (queue_date, status, opened_at)
     VALUES ('2099-01-01', 'OPEN', UTC_TIMESTAMP(3))`
  );
  created.queueId = queue.insertId;

  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const initialCatalog = await request(baseUrl, '/catalog');
  assert.equal(initialCatalog.response.status, 200);
  assert.equal(initialCatalog.json.ticketPrintingEnabled, false);
  const anonymousPrintSetting = await request(baseUrl, '/admin/settings/ticket-printing', {
    method: 'PUT',
    body: { enabled: true }
  });
  assert.equal(anonymousPrintSetting.response.status, 401);

  const login = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: { username: `${prefix}_operator`, password }
  });
  assert.equal(login.response.status, 200);
  const staffCookie = sessionCookie(login.response);

  const forbiddenPrintSetting = await request(baseUrl, '/admin/settings/ticket-printing', {
    method: 'PUT',
    cookie: staffCookie,
    body: { enabled: true }
  });
  assert.equal(forbiddenPrintSetting.response.status, 403);

  const stationList = await request(baseUrl, '/staff/service-stations', { cookie: staffCookie });
  assert.equal(stationList.response.status, 200);
  assert.deepEqual(
    stationList.json.servicePoints.map((point) => point.servicePointId),
    [created.servicePoints[0]],
    'staff should only receive assigned stations'
  );

  const unassignedCall = await request(baseUrl, `/queues/${created.queueId}/call-next`, {
    method: 'POST',
    cookie: staffCookie,
    body: { servicePointId: created.servicePoints[1] }
  });
  assert.equal(unassignedCall.response.status, 409);
  assert.match(unassignedCall.json.error.message, /not assigned/i);

  const unassignedStation = await request(baseUrl, '/staff/current-station', {
    method: 'PUT',
    cookie: staffCookie,
    body: { servicePointId: created.servicePoints[1] }
  });
  assert.equal(unassignedStation.response.status, 403);

  const firstTicket = await request(baseUrl, `/queues/${created.queueId}/tickets`, {
    method: 'POST',
    body: { serviceTypeId: created.serviceTypes[0] }
  });
  const otherStationTicket = await request(baseUrl, `/queues/${created.queueId}/tickets`, {
    method: 'POST',
    body: { serviceTypeId: created.serviceTypes[1] }
  });
  const secondEligibleTicket = await request(baseUrl, `/queues/${created.queueId}/tickets`, {
    method: 'POST',
    body: { serviceTypeId: created.serviceTypes[0] }
  });
  assert.deepEqual(
    [firstTicket.json.sequenceNumber, otherStationTicket.json.sequenceNumber, secondEligibleTicket.json.sequenceNumber],
    [1, 2, 3]
  );

  const assistedCheckIn = await request(baseUrl, `/staff/queues/${created.queueId}/tickets`, {
    method: 'POST',
    cookie: staffCookie,
    body: { serviceTypeId: created.serviceTypes[0] }
  });
  assert.equal(assistedCheckIn.response.status, 201);
  assert.equal(assistedCheckIn.json.sequenceNumber, 4);
  const [assistedTicketRows] = await pool.execute(
    `SELECT ticket.checked_in_by_staff_id, event.event_type
     FROM queue_tickets AS ticket
     LEFT JOIN staff_audit_events AS event
       ON event.ticket_id = ticket.ticket_id AND event.event_type = 'ASSISTED_CHECK_IN'
     WHERE ticket.ticket_id = ?`,
    [assistedCheckIn.json.ticketId]
  );
  assert.equal(assistedTicketRows[0]?.checked_in_by_staff_id, login.json.staff.staffId);
  assert.equal(assistedTicketRows[0]?.event_type, 'ASSISTED_CHECK_IN');

  const called = await request(baseUrl, `/queues/${created.queueId}/call-next`, {
    method: 'POST',
    cookie: staffCookie,
    body: { servicePointId: created.servicePoints[0] }
  });
  assert.equal(called.response.status, 200);
  assert.equal(called.json.ticketId, firstTicket.json.ticketId, 'station should call oldest eligible ticket');

  await request(baseUrl, `/tickets/${firstTicket.json.ticketId}/call-outcomes`, {
    method: 'POST',
    cookie: staffCookie,
    body: { attemptNumber: 1, outcome: 'ACKNOWLEDGED' }
  }).then(({ response }) => assert.equal(response.status, 204));
  await request(baseUrl, `/tickets/${firstTicket.json.ticketId}/start`, {
    method: 'POST',
    cookie: staffCookie,
    body: { servicePointId: created.servicePoints[0] }
  }).then(({ response }) => assert.equal(response.status, 204));
  await request(baseUrl, `/tickets/${firstTicket.json.ticketId}/complete`, {
    method: 'POST',
    cookie: staffCookie
  }).then(({ response }) => assert.equal(response.status, 204));

  const secondCalled = await request(baseUrl, `/queues/${created.queueId}/call-next`, {
    method: 'POST',
    cookie: staffCookie,
    body: { servicePointId: created.servicePoints[0] }
  });
  assert.equal(secondCalled.json.ticketId, secondEligibleTicket.json.ticketId);

  const returned = await request(baseUrl, `/tickets/${secondEligibleTicket.json.ticketId}/return-to-queue`, {
    method: 'POST',
    cookie: staffCookie
  });
  assert.equal(returned.response.status, 204);
  const recalled = await request(baseUrl, `/queues/${created.queueId}/call-next`, {
    method: 'POST',
    cookie: staffCookie,
    body: { servicePointId: created.servicePoints[0] }
  });
  assert.equal(recalled.json.ticketId, secondEligibleTicket.json.ticketId, 'returned ticket should retain priority');

  await request(baseUrl, `/tickets/${secondEligibleTicket.json.ticketId}/call-outcomes`, {
    method: 'POST',
    cookie: staffCookie,
    body: { attemptNumber: 1, outcome: 'NO_RESPONSE' }
  }).then(({ response }) => assert.equal(response.status, 204));
  await request(baseUrl, `/tickets/${secondEligibleTicket.json.ticketId}/repeat-call`, {
    method: 'POST',
    cookie: staffCookie
  }).then(({ response }) => assert.equal(response.status, 201));
  await request(baseUrl, `/tickets/${secondEligibleTicket.json.ticketId}/call-outcomes`, {
    method: 'POST',
    cookie: staffCookie,
    body: { attemptNumber: 2, outcome: 'NO_RESPONSE' }
  }).then(({ response }) => assert.equal(response.status, 204));
  await request(baseUrl, `/tickets/${secondEligibleTicket.json.ticketId}/no-show`, {
    method: 'POST',
    cookie: staffCookie
  }).then(({ response }) => assert.equal(response.status, 204));

  const stats = await request(baseUrl, '/staff/my-stats', { cookie: staffCookie });
  assert.equal(stats.response.status, 200);
  assert.equal(stats.json.ticketsCompleted, 1);
  assert.equal(stats.json.noShows, 1);
  assert.equal(stats.json.ticketsReturned, 1);
  assert.equal(stats.json.byServicePoint.length, 1);
  assert.equal(stats.json.byServicePoint[0].servicePointId, created.servicePoints[0]);

  const adminLogin = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: { username: `${prefix}_admin`, password }
  });
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = sessionCookie(adminLogin.response);
  const enabledPrinting = await request(baseUrl, '/admin/settings/ticket-printing', {
    method: 'PUT',
    cookie: adminCookie,
    body: { enabled: true }
  });
  assert.equal(enabledPrinting.response.status, 204);
  const enabledCatalog = await request(baseUrl, '/catalog');
  assert.equal(enabledCatalog.json.ticketPrintingEnabled, true);
  const adminConfiguration = await request(baseUrl, '/admin/configuration', {
    cookie: adminCookie
  });
  assert.equal(adminConfiguration.json.ticketPrintingEnabled, true);

  const disabledPrinting = await request(baseUrl, '/admin/settings/ticket-printing', {
    method: 'PUT',
    cookie: adminCookie,
    body: { enabled: false }
  });
  assert.equal(disabledPrinting.response.status, 204);
  const disabledCatalog = await request(baseUrl, '/catalog');
  assert.equal(disabledCatalog.json.ticketPrintingEnabled, false);

  const report = await request(baseUrl, '/admin/staff-stats', { cookie: adminCookie });
  assert.equal(report.response.status, 200);
  const operatorReport = report.json.staffStats.find(
    (row) => row.staffId === login.json.staff.staffId
  );
  assert.ok(operatorReport);
  assert.equal(operatorReport.stats.ticketsCompleted, stats.json.ticketsCompleted);
  assert.equal(operatorReport.stats.noShows, stats.json.noShows);
  assert.equal(operatorReport.stats.ticketsReturned, stats.json.ticketsReturned);
  assert.deepEqual(operatorReport.stats.byServicePoint, stats.json.byServicePoint);

  const anonymousStats = await request(baseUrl, '/staff/my-stats');
  assert.equal(anonymousStats.response.status, 401);
  const forbiddenReport = await request(baseUrl, '/admin/staff-stats', {
    cookie: staffCookie
  });
  assert.equal(forbiddenReport.response.status, 403);

  const operatorId = login.json.staff.staffId;
  const renamedAccount = await request(baseUrl, `/admin/staff/${operatorId}`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      displayName: `${prefix} operator`,
      username: `${prefix}_renamed`,
      role: 'STAFF',
      isActive: true,
      servicePointIds: [created.servicePoints[0]]
    }
  });
  assert.equal(renamedAccount.response.status, 204, 'admin should be able to edit a username');
  const renamedLogin = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: { username: `${prefix}_renamed`, password }
  });
  assert.equal(renamedLogin.response.status, 200, 'updated username should authenticate');

  const deactivatedAccount = await request(baseUrl, `/admin/staff/${operatorId}`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      displayName: `${prefix} operator`,
      username: `${prefix}_renamed`,
      role: 'STAFF',
      isActive: false,
      servicePointIds: [created.servicePoints[0]]
    }
  });
  assert.equal(deactivatedAccount.response.status, 204, 'admin should be able to deactivate staff');
  const rejectedFormerStaffLogin = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: { username: `${prefix}_renamed`, password }
  });
  assert.equal(rejectedFormerStaffLogin.response.status, 401);

  const finalReport = await request(baseUrl, '/admin/staff-stats', { cookie: adminCookie });
  const archivedOperatorStats = finalReport.json.staffStats.find(
    (row) => row.staffId === operatorId
  );
  assert.ok(archivedOperatorStats, 'deactivated staff stats should remain available to admins');
  assert.equal(archivedOperatorStats.stats.ticketsCompleted, 1);

  const concurrentCheckIns = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(baseUrl, `/queues/${created.queueId}/tickets`, {
        method: 'POST',
        body: { serviceTypeId: created.serviceTypes[0] }
      })
    )
  );
  assert.ok(
    concurrentCheckIns.every(({ response }) => response.status === 201),
    'all simultaneous kiosk check-ins should succeed'
  );
  const concurrentTickets = concurrentCheckIns.map(({ json }) => json);
  const concurrentSequences = concurrentTickets
    .map((ticket) => ticket.sequenceNumber)
    .sort((left, right) => left - right);
  assert.deepEqual(
    concurrentSequences,
    Array.from({ length: 8 }, (_, index) => index + 5),
    'simultaneous check-ins should receive distinct sequential numbers'
  );

  const concurrentTicketIds = new Set(concurrentTickets.map((ticket) => ticket.ticketId));
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const restartedAddress = server.address();
  assert.ok(restartedAddress && typeof restartedAddress === 'object');
  const restartedBaseUrl = `http://127.0.0.1:${restartedAddress.port}/api`;
  const persistedQueue = await request(
    restartedBaseUrl,
    `/queues/${created.queueId}/tickets`
  );
  assert.equal(persistedQueue.response.status, 200);
  const persistedConcurrentTickets = persistedQueue.json.tickets.filter((ticket) =>
    concurrentTicketIds.has(ticket.ticketId)
  );
  assert.equal(
    persistedConcurrentTickets.length,
    concurrentTickets.length,
    'all concurrent tickets should remain in the database after restarting the API listener'
  );
  assert.deepEqual(
    persistedConcurrentTickets.map((ticket) => ticket.sequenceNumber),
    concurrentSequences,
    'ticket order should remain stable after restarting the API listener'
  );

  console.log('Server integration checks passed: kiosk and assisted check-in, simultaneous FCFS numbering, API listener restart persistence, station authorization, queue lifecycle, staff stats, printing settings, username changes, deactivation, and retained history.');
} finally {
  await cleanup();
}
