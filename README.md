# Walk-in queue: database/model starter

**Author:** Kris Olakulehin

This is the foundation for a configurable, single-location, first-come-first-served walk-in queue. It contains the MySQL schema, TypeScript model layer, local Node.js HTTP API, self-service check-in, and service-point workspace. Service names and service-point names come from database configuration; the model is not specific to a particular sector.

## Prerequisites

- Node.js 20.19 or newer
- MySQL 8.0.16 or newer
- MySQL command-line client

## Set up the database

Create the database and a dedicated local application user in MySQL. Choose your own password; do not commit it:

```sql
CREATE DATABASE walk_in_queue CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'queue_app'@'localhost' IDENTIFIED BY 'choose-a-local-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON walk_in_queue.* TO 'queue_app'@'localhost';
```

From the `server` folder, apply the schema as a database administrator:

```powershell
Get-Content .\database\schema.sql | mysql -u root -p walk_in_queue
```

## Run server integration checks safely

The integration suite exercises the queue API against a dedicated MySQL database. It refuses to run unless `TEST_DB_NAME` is set to a database name ending in `_test`, and it must differ from `DB_NAME`. Never point it at a database containing real or needed data.

Create a separate empty test database and grant the local application user access to it. Apply the current schema to that database before running the suite. For example, replace `queue_test_app` with your local database user:

```sql
CREATE DATABASE walk_in_queue_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE ON walk_in_queue_test.* TO 'queue_test_app'@'localhost';
```

From the `server` folder, set the test database name for the current PowerShell window and run:

```powershell
Get-Content .\database\schema.sql | mysql -u root -p walk_in_queue_test
$env:TEST_DB_NAME = 'walk_in_queue_test'
npm run test:integration
```

The integration suite inserts uniquely named records and deletes only those records after its run. The test database itself is retained. Client component tests and production builds can be run separately from the `client` folder using `npm test -- --watch=false` and `npm run build`.

Create a service, a service point, and their relationship:

```sql
INSERT INTO service_types (name, created_at)
VALUES ('Your service name', UTC_TIMESTAMP(3));
INSERT INTO service_points (name, created_at)
VALUES ('Service point 1', UTC_TIMESTAMP(3));
INSERT INTO service_point_service_types (service_point_id, service_type_id)
SELECT sp.service_point_id, st.service_type_id
FROM service_points AS sp
CROSS JOIN service_types AS st
WHERE sp.name = 'Service point 1'
  AND st.name = 'Your service name';
```

Create as many service points as needed, and map each point to one or more services. The customer check-in screen only offers services handled by at least one active service point. Service routing is based on service point, not a particular sector or staff member.

If you already have a local database from the earlier prototype, apply migrations in order from the `server` folder using DBeaver's SQL editor:

1. Run `database/migrations/002-service-points.sql`.
2. Run `database/migrations/003-initial-service-point.sql`.
3. Run `database/migrations/004-staff-auth-audit.sql`.
4. Run `database/migrations/005-admin-configuration.sql`.
5. Run `database/migrations/006-service-stations-and-priority-recall.sql`.
6. Run `database/migrations/007-staff-login-duration.sql`.
7. Run `database/migrations/008-active-staff-station.sql`.
8. Run `database/migrations/009-optional-ticket-printing.sql`.

The second migration creates a generic `Service point 1` and maps existing active staff/service qualifications to it. The fourth adds staff sign-in sessions and audit events; the fifth adds administrator roles and configuration auditing. The sixth adds staff-to-station assignments and priority returns for called tickets; existing active accounts are assigned to all active stations during this migration so access continues until an administrator customizes those assignments. The seventh retains sign-in and sign-out times for cumulative login-duration reporting. The eighth records each active staff session's selected station so the staff workspace and administrator table can show current and historical work locations. The ninth adds optional kiosk ticket printing, initially disabled. Do not rerun a migration that has already been applied.

## Configure and type-check

From the `server` folder:

```powershell
Copy-Item .env.example .env
```

Edit `.env` with the local database connection values. Never commit `.env` or put production credentials in source control. Then install dependencies and run the TypeScript check:

```powershell
npm install
npm run typecheck
npm run build
```

## Run the local API

From the `server` folder, start the API in watch mode while developing:

```powershell
npm run dev
```

The API listens on `http://127.0.0.1:3000` by default. The server is deliberately bound to the local machine. Do not change `API_HOST` to expose it on a network or use it with real customers; this prototype still needs production-grade security, deployment, and recovery work.

For an existing local database, apply migrations 004 through 009 before starting the authenticated staff workflow. Create an individual staff sign-in from the `server` folder:

```powershell
npm run staff:create
```

Run this command in an interactive terminal. Enter a display name, username, and a password of at least 12 characters; password input is masked and only a scrypt hash is stored. If exactly one active staff record already has that display name and has no account, the account is linked to it; otherwise a new staff record is created. Repeat the command once for each staff member. To bootstrap the first administrator, promote an existing account from the `server` folder:

```powershell
npm run staff:promote-admin -- username
```

Administrators can then open `/admin` to manage services, service stations and routing, and staff accounts. Assign one or more stations to each staff account; active existing accounts are initially assigned to all active stations by migration 006. Staff with one assignment have it selected automatically; staff with multiple assignments choose the station they are physically working at after each sign-in. The selection is retained for that signed-in session, shown in the staff workspace, and visible to administrators. Administrators can edit staff usernames, review per-person performance including all-time sign-in hours, and deactivate accounts when someone leaves. Deactivation prevents future sign-in but retains ticket, audit, and performance history; inactive accounts are available in a collapsed section and can be reactivated. The service desk performance panel shows only the signed-in person's own stats, including when that person is an administrator. The staff workspace also shows station-by-station activity; administrators see each staff member's historical totals by station. The staff workspace at `/` is available to signed-in staff with assigned stations; `/admin` requires an administrator. The kiosk at `/kiosk` and waiting-room display at `/display` remain public.

Staff sessions use an HttpOnly, SameSite=Strict cookie and expire after 12 hours. The staff workspace groups each staff member’s all-time statistics in a “My stats” panel: cumulative sign-in time, completed tickets, tickets marked no-show, and returns to the queue. Queue-operation totals are also broken down by the service station where the action occurred. Sign-in sessions that expire or are abandoned are capped at 12 hours. Administrators can see and refresh a per-staff table with sign-in time, queue-operation totals, current station, and station-by-station history in `/admin`. The local API remains bound to `127.0.0.1`; this authentication work is for local workflow testing and is not by itself production readiness.

## Local browser setup and optional ticket printing

For the MVP, use QueueDesk as a **browser-based local web app**, not a separate installed app on every device. One always-on computer at the location hosts the API and database; kiosk, staff, and display devices use their browsers. This keeps updates and queue data in one place and avoids committing to a kiosk operating system before choosing hardware. The current development API binds to `127.0.0.1`, so it is only accessible from its own computer; do not expose the development server directly to a shared or public network. Before multi-device use, configure an appropriately secured private local network deployment.

Ticket printing is optional and off by default. An administrator can enable it under **Admin → Kiosk ticket printing**. After check-in, the kiosk continues to show the ticket number and offers **Print or reprint ticket**; pressing it again prints the same ticket and does not create a second queue entry or change queue position. With printing off, the on-screen ticket remains available. Admins can use **Test print** to open the browser's print dialog with a sample 80 mm receipt layout.

The browser print dialog is intentional for this OS-independent prototype: it lets the operator choose an installed printer, but it is not a silent unattended print flow and the app cannot detect paper, printer connectivity, or whether a print succeeded. For a physical pilot, a receipt-style 80 mm thermal printer is a reasonable starting point, but first confirm driver support for the selected kiosk device/OS and test paper size, legibility, and reprint behavior. Do not promise silent printing until the kiosk hardware and OS are chosen; that may require kiosk-browser configuration or a local print service. The queue itself remains local and should not depend on internet access.

## Run the Angular staff interface

Open a second PowerShell window and from the `client` folder:

```powershell
npm install
npm start
```

Open `http://localhost:4200` for the signed-in staff workspace, `http://localhost:4200/kiosk` for visitor check-in, or `http://localhost:4200/display` on a waiting-room screen. The Angular dev server proxies `/api` calls to the local API. Start the API first. After sign-in, staff work from one of their administrator-assigned service stations; when multiple stations are assigned, the selected station is saved to that signed-in session and shown to administrators. Queue actions are server-checked against the account’s assignments. The workspace supports an automatically refreshed FCFS waiting list, calling the next ticket eligible for the selected station, recording/repeating calls, no-show handling, and starting/completing service. Visitors normally join through the kiosk; staff-assisted check-in remains available for visitors who need help. Staff-assisted check-in and queue-handling actions are attributed to the signed-in staff member. If a customer is briefly unavailable after being called, staff can return that same ticket to the front of its eligible queue; its ticket number and earlier call history remain intact, and the return is audited. Administrators can view the recent activity feed; it is not available to standard staff accounts. The workspace and public display refresh every four seconds. The display separates called tickets from customers currently being attended to, shows their stations, and highlights the oldest waiting ticket (including priority returns) as **Please be ready** without assigning a station until staff call them. It does not show visitor details. On the public display, select **Enable sound** before calls begin to hear spoken ticket announcements; repeated calls are announced again. Sound is off until enabled and can be muted at any time. No-show tickets are listed separately; if a visitor returns, select **Rejoin at end** to issue a new number linked to the original. A no-show can only be rejoined once.

The database must contain active services and at least one active service point mapped to each offered service before the interface can process customers. Configure these generically in DBeaver:

```sql
INSERT INTO service_points (name, created_at)
VALUES ('Service point 2', UTC_TIMESTAMP(3));

INSERT INTO service_point_service_types (service_point_id, service_type_id)
SELECT sp.service_point_id, st.service_type_id
FROM service_points AS sp
JOIN service_types AS st ON st.name = 'Your service name'
WHERE sp.name = 'Service point 2';
```

Replace the example names with the terms that make sense at your organization. A service point can be connected to multiple services, and a service can be handled by multiple points.

All JSON request examples below can be sent from PowerShell with `Invoke-RestMethod`:

```powershell
$baseUrl = 'http://127.0.0.1:3000/api'
$queue = Invoke-RestMethod -Method Post -Uri "$baseUrl/queues/today" `
  -ContentType 'application/json' -Body '{"queueDate":"2026-10-13"}'

$ticket = Invoke-RestMethod -Method Post -Uri "$baseUrl/queues/$($queue.queueId)/tickets" `
  -ContentType 'application/json' -Body '{"serviceTypeId":1}'

Invoke-RestMethod -Method Get -Uri "$baseUrl/queues/$($queue.queueId)/tickets"
```

Use the location's local date for `queueDate`. The request and response shapes are:

| Method | Route | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | API and database health |
| `GET` | `/api/catalog` | — | Active services, staff, configured service points, and public ticket-printing-enabled flag |
| `POST` | `/api/auth/login` | `{ "username": "...", "password": "..." }` | Sign in staff; establishes an HttpOnly session cookie |
| `GET` | `/api/auth/me` | — | Current signed-in staff identity (staff only) |
| `GET` | `/api/staff/my-stats` | — | All-time sign-in duration and queue-operation totals for the signed-in staff account |
| `GET` | `/api/staff/current-station` | — | Current session's selected station, if any |
| `PUT` | `/api/staff/current-station` | `{ "servicePointId": 1 }` | Set the active station for this signed-in staff session; only assigned active stations are accepted |
| `GET` | `/api/admin/staff-stats` | — | Admin-only current stations and all-time per-station activity totals for each staff member |
| `PUT` | `/api/admin/settings/ticket-printing` | `{ "enabled": true }` | Enable or disable optional kiosk printing (administrator only) |
| `POST` | `/api/auth/logout` | — | End staff session |
| `GET` | `/api/staff/service-stations` | — | Active stations assigned to the signed-in staff member |
| `POST` | `/api/queues/today` | `{ "queueDate": "YYYY-MM-DD" }` | Open or retrieve that day's queue |
| `POST` | `/api/queues/:queueId/tickets` | `{ "serviceTypeId": 1 }` | Public kiosk check-in |
| `POST` | `/api/staff/queues/:queueId/tickets` | `{ "serviceTypeId": 1 }` | Staff-assisted check-in (staff only); optional `requeuedFromTicketId` rejoins a no-show |
| `GET` | `/api/queues/:queueId/tickets` | — | Waiting tickets in FCFS order |
| `GET` | `/api/queues/:queueId/active-tickets` | — | Called and in-service tickets |
| `GET` | `/api/queues/:queueId/no-show-tickets` | — | No-show tickets eligible to rejoin (staff only) |
| `GET` | `/api/staff/queues/:queueId/activity` | — | Recent attributed staff actions (administrator only) |
| `POST` | `/api/queues/:queueId/call-next` | `{ "servicePointId": 1 }` | Claim and call the oldest eligible ticket at an assigned station; `204` if none (staff only) |
| `POST` | `/api/tickets/:ticketId/call-outcomes` | `{ "attemptNumber": 1, "outcome": "NO_RESPONSE" }` | Record a call result (staff only) |
| `POST` | `/api/tickets/:ticketId/repeat-call` | — | Repeat a first call with no response (staff only) |
| `POST` | `/api/tickets/:ticketId/no-show` | — | Mark no-show after both calls got no response (staff only) |
| `POST` | `/api/tickets/:ticketId/return-to-queue` | — | Return a called ticket to the front of its eligible queue (staff only) |
| `POST` | `/api/tickets/:ticketId/start` | `{ "servicePointId": 1 }` | Start service at the point that called the ticket (staff only) |
| `POST` | `/api/tickets/:ticketId/complete` | — | Complete an in-service ticket (staff only) |

Invalid requests return JSON `400` errors; invalid queue-state transitions return JSON `409` errors. The API never accepts or returns customer names or contact details.

## Queue model workflow

The API calls the functions from `server/src/models/queue.model.ts`:

1. `openDailyQueue('YYYY-MM-DD')` gets or creates that day's queue. Supply the date in the location's timezone.
2. `checkInWalkIn(queueId, serviceTypeId)` issues the next sequence number; staff-assisted check-ins also store staff attribution. A signed-in staff member can rejoin a returning no-show with the original ticket ID.
3. `getWaitingTickets(queueId)` returns priority-return tickets first, then other waiting tickets in arrival order.
4. `callNextTicket(queueId, servicePointId)` atomically claims the oldest waiting ticket for a service mapped to that station, after confirming the staff member is assigned there. A service can be mapped to multiple stations, and a station can handle multiple services.
5. Record each call with `recordCallOutcome`. For no response on the first call, use `repeatCall`; after the second no-response result, use `markNoShow`.
6. After an acknowledged call, use `startService` and then `completeService`.
7. If a called visitor is briefly unavailable, `returnCalledTicketToQueue(ticketId, staffId)` restores that same ticket to the front of the eligible waiting order and records the action. A future call starts a new call round, while each round still allows the normal two attempts before no-show.

The schema intentionally stores no customer name or contact details. Ticket sequence numbers are unique per daily queue. Queue-level row locking serializes check-ins and calls so concurrent staff actions cannot allocate duplicate numbers or call the same next ticket. FCFS is maintained across eligible tickets: a service point calls the earliest ticket for one of its configured services.

## Pilot readiness and operational rehearsal

The main queue lifecycle, station authorization, simultaneous kiosk check-ins, sequential ticket numbering, and persistence across an API-listener restart have server integration coverage. Run the isolated integration suite as described above after schema changes. The Angular unit suite currently covers kiosk and staff/admin UI behavior; it can be run from the `client` folder:

```powershell
npm test -- --watch=false
npm run build
```

Before a supervised on-site pilot, use test visitors and verify all of the following on the actual kiosk, staff devices, and waiting-room display:

1. Check in multiple visitors for different services from both the kiosk and receptionist-assisted flow. Confirm ticket numbering and ordering.
2. At two configured service points, verify each can call the oldest waiting visitor whose service it handles, and that selecting another assigned station updates the staff view and administrator's current-station report.
3. Verify a staff member cannot call or manage tickets at an unassigned station.
4. Exercise acknowledged call, no response, second call, no-show, return-to-front, service start, and completion. Confirm the same ticket number is retained on a priority return.
5. Check that each staff member sees only their own statistics, while the administrator can inspect all staff and station breakdowns.
6. Reload each browser and reconnect after briefly stopping/restarting the local API. Confirm the queue and activity remain consistent.
7. Confirm the public display is readable at the actual screen size, does not expose customer details, and its sound works only after a user enables it.

Before relying on the system for a live queue, establish and rehearse database backup and restore. For a local rehearsal, use MySQL Workbench/DBeaver or `mysqldump` to create a dump of the queue database, restore it to a separate empty database (never over the active database), and verify that services, service points, staff access, and a sample queue are present. Keep backup files outside the source repository and restrict access because they include staff account hashes and operational history. A backup is not verified until a restore has been tested.

Write down an outage fallback before the pilot: who declares the system unavailable, how reception issues distinct paper tickets, how staff preserve arrival order and service routing, who prevents duplicate numbers when resuming, and how paper-handled visitors are reconciled. The app does not yet provide offline queue operation or automatic paper-to-system reconciliation.

## Current scope and production gates

QueueDesk is a local prototype suitable for demonstrations and a supervised test pilot—not yet a production deployment for unsupervised real visitors. The queue lifecycle, station authorization, staff attribution, session accounting, and administrator reporting are implemented and covered by automated checks. The complete Angular and server suites build locally.

Still required before production use:

- Complete the on-site acceptance and recovery rehearsal above.
- Choose and configure a hosting environment, TLS, production database access, secure cookie settings, CORS origins, secret management, and a supported deployment/update process. The API currently binds to `127.0.0.1` by default; do not expose the development setup directly to a network.
- Define monitored service health, actionable error logs, backup schedule/retention, restore ownership, and incident response.
- Review authentication against the selected deployment threat model, including login throttling and session revocation procedures.
- Decide whether managers need corrections to ticket history, and whether activity reports need date/shift filters rather than all-time totals.

For any future schema change, add and apply a new numbered migration; do not edit an already-applied migration or alter a live database manually without a verified backup.
