import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { pool } from './db/pool.js';
import {
  clearSessionCookie,
  authenticatedStaff,
  requireStaff,
  sessionCookie,
  sessionTokenFromRequest,
  requireAdmin
} from './staff-auth.js';
import {
  getStaffSessionServicePoint,
  loginStaff,
  logoutStaff,
  setStaffSessionServicePoint
} from './models/staff-auth.model.js';
import {
  getAdminStaffStats,
  getStaffStats
} from './models/staff-stats.model.js';
import {
  createManagedStaffAccount,
  createService,
  createServicePoint,
  getAdminConfiguration,
  updateManagedStaffAccount,
  updateTicketPrintingEnabled,
  updateService,
  updateServicePoint,
  updateServicePointServices,
  validateAdminServiceInput,
  validateAdminServicePointName,
  validateManagedPassword,
  validateManagedUsername
} from './models/admin.model.js';
import { getTicketPrintingEnabled } from './models/app-settings.model.js';
import {
  callNextTicket,
  checkInWalkIn,
  completeService,
  getActiveTickets,
  getActiveStaff,
  getActiveServicePoints,
  getNoShowTickets,
  getStaffActivity,
  getServiceTypes,
  getWaitingTickets,
  openDailyQueue,
  QueueError,
  recordCallOutcome,
  repeatCall,
  markNoShow,
  returnCalledTicketToQueue,
  startService,
  type CallOutcome
} from './models/queue.model.js';

class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  const parsedValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new RequestValidationError(`${fieldName} must be a positive integer`);
  }

  return parsedValue;
}

function parseBodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RequestValidationError('Request body must be a JSON object');
  }

  return body as Record<string, unknown>;
}

function parseCallOutcome(value: unknown): CallOutcome {
  if (value !== 'ACKNOWLEDGED' && value !== 'NO_RESPONSE') {
    throw new RequestValidationError('outcome must be ACKNOWLEDGED or NO_RESPONSE');
  }

  return value;
}

function parseQueueDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestValidationError('queueDate must use YYYY-MM-DD format');
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) {
    throw new RequestValidationError('queueDate must be a valid calendar date');
  }

  return value;
}

function parseString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new RequestValidationError(`${fieldName} must be a string`);
  }
  return value;
}

function parseBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RequestValidationError(`${fieldName} must be true or false`);
  }
  return value;
}

function parsePositiveIntegerArray(value: unknown, fieldName: string): number[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${fieldName} must be an array of positive integers`);
  }
  const values = value.map((item) => parsePositiveInteger(item, fieldName));
  if (new Set(values).size !== values.length) {
    throw new RequestValidationError(`${fieldName} must not contain duplicates`);
  }
  return values;
}

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.ANGULAR_ORIGIN ?? 'http://localhost:4200',
      methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowedHeaders: ['Content-Type']
    })
  );
  app.use(express.json({ limit: '16kb' }));
  const staffOnly = requireStaff();
  const adminOnly = [staffOnly, requireAdmin] as const;

  app.get('/api/health', async (_request, response) => {
    try {
      await pool.query('SELECT 1');
      response.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error('API health check could not reach the database', error);
      response.status(503).json({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'The queue database is unavailable' }
      });
    }
  });

  app.get('/api/catalog', async (_request, response) => {
    const [serviceTypes, staff, servicePoints, ticketPrintingEnabled] = await Promise.all([
      getServiceTypes(),
      getActiveStaff(),
      getActiveServicePoints(),
      getTicketPrintingEnabled()
    ]);
    response.json({ serviceTypes, staff, servicePoints, ticketPrintingEnabled });
  });

  app.post('/api/auth/login', async (request, response) => {
    const body = parseBodyObject(request.body);
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      throw new RequestValidationError('username and password are required');
    }
    const result = await loginStaff(body.username, body.password);
    if (!result) {
      response.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Username or password is incorrect.' }
      });
      return;
    }

    response.setHeader('Set-Cookie', sessionCookie(result.token));
    response.json({ staff: result.staff, expiresAt: result.expiresAt.toISOString() });
  });

  app.get('/api/auth/me', staffOnly, async (request, response) => {
    response.json({ staff: authenticatedStaff(request) });
  });

  app.get('/api/staff/my-stats', staffOnly, async (request, response) => {
    const { staffId } = authenticatedStaff(request);
    response.json(await getStaffStats(staffId));
  });

  app.get('/api/staff/current-station', staffOnly, async (request, response) => {
    const token = sessionTokenFromRequest(request);
    if (!token) {
      response.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Please sign in to view your station.' }
      });
      return;
    }
    const { staffId } = authenticatedStaff(request);
    response.json({
      servicePointId: await getStaffSessionServicePoint(token, staffId)
    });
  });

  app.put('/api/staff/current-station', staffOnly, async (request, response) => {
    const body = parseBodyObject(request.body);
    const servicePointId = parsePositiveInteger(body.servicePointId, 'servicePointId');
    const token = sessionTokenFromRequest(request);
    if (!token) {
      response.status(401).json({
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Please sign in to select a station.' }
      });
      return;
    }
    const { staffId } = authenticatedStaff(request);
    const updated = await setStaffSessionServicePoint(token, staffId, servicePointId);
    if (!updated) {
      response.status(403).json({
        error: {
          code: 'SERVICE_STATION_NOT_ASSIGNED',
          message: 'Choose an active service station assigned to your account.'
        }
      });
      return;
    }
    response.status(204).end();
  });

  app.get('/api/admin/staff-stats', ...adminOnly, async (_request, response) => {
    response.json({ staffStats: await getAdminStaffStats() });
  });

  app.post('/api/auth/logout', async (request, response) => {
    const token = sessionTokenFromRequest(request);
    if (token) {
      await logoutStaff(token);
    }
    response.setHeader('Set-Cookie', clearSessionCookie());
    response.status(204).end();
  });

  app.get('/api/admin/configuration', ...adminOnly, async (_request, response) => {
    response.json(await getAdminConfiguration());
  });

  app.put('/api/admin/settings/ticket-printing', ...adminOnly, async (request, response) => {
    const body = parseBodyObject(request.body);
    const enabled = parseBoolean(body.enabled, 'enabled');
    await updateTicketPrintingEnabled(enabled);
    response.status(204).end();
  });

  app.post('/api/admin/services', ...adminOnly, async (request, response) => {
    const body = parseBodyObject(request.body);
    let input: { name: string; description: string | null };
    try {
      input = validateAdminServiceInput(
        parseString(body.name, 'name'),
        body.description === null || body.description === undefined
          ? null
          : parseString(body.description, 'description')
      );
    } catch (error) {
      throw new RequestValidationError(error instanceof Error ? error.message : 'Invalid service.');
    }
    const serviceTypeId = await createService(
      authenticatedStaff(request).staffId,
      input.name,
      input.description
    );
    response.status(201).json({ serviceTypeId });
  });

  app.post('/api/admin/services/:serviceTypeId', ...adminOnly, async (request, response) => {
    const serviceTypeId = parsePositiveInteger(request.params.serviceTypeId, 'serviceTypeId');
    const body = parseBodyObject(request.body);
    let input: { name: string; description: string | null };
    try {
      input = validateAdminServiceInput(
        parseString(body.name, 'name'),
        body.description === null || body.description === undefined
          ? null
          : parseString(body.description, 'description')
      );
    } catch (error) {
      throw new RequestValidationError(error instanceof Error ? error.message : 'Invalid service.');
    }
    await updateService(
      authenticatedStaff(request).staffId,
      serviceTypeId,
      input.name,
      input.description,
      parseBoolean(body.isActive, 'isActive')
    );
    response.status(204).end();
  });

  app.post('/api/admin/service-points', ...adminOnly, async (request, response) => {
    const body = parseBodyObject(request.body);
    let name: string;
    try {
      name = validateAdminServicePointName(parseString(body.name, 'name'));
    } catch (error) {
      throw new RequestValidationError(error instanceof Error ? error.message : 'Invalid service point.');
    }
    const servicePointId = await createServicePoint(authenticatedStaff(request).staffId, name);
    response.status(201).json({ servicePointId });
  });

  app.post('/api/admin/service-points/:servicePointId', ...adminOnly, async (request, response) => {
    const servicePointId = parsePositiveInteger(request.params.servicePointId, 'servicePointId');
    const body = parseBodyObject(request.body);
    let name: string;
    try {
      name = validateAdminServicePointName(parseString(body.name, 'name'));
    } catch (error) {
      throw new RequestValidationError(error instanceof Error ? error.message : 'Invalid service point.');
    }
    await updateServicePoint(
      authenticatedStaff(request).staffId,
      servicePointId,
      name,
      parseBoolean(body.isActive, 'isActive')
    );
    response.status(204).end();
  });

  app.post(
    '/api/admin/service-points/:servicePointId/services',
    ...adminOnly,
    async (request, response) => {
      const servicePointId = parsePositiveInteger(request.params.servicePointId, 'servicePointId');
      const body = parseBodyObject(request.body);
      await updateServicePointServices(
        authenticatedStaff(request).staffId,
        servicePointId,
        parsePositiveIntegerArray(body.serviceTypeIds, 'serviceTypeIds')
      );
      response.status(204).end();
    }
  );

  app.post('/api/admin/staff', ...adminOnly, async (request, response) => {
    const body = parseBodyObject(request.body);
    const displayName = parseString(body.displayName, 'displayName').trim();
    const username = parseString(body.username, 'username');
    const password = parseString(body.password, 'password');
    const role = body.role;
    if (role !== 'ADMIN' && role !== 'STAFF') {
      throw new RequestValidationError('role must be ADMIN or STAFF');
    }
    if (!displayName || displayName.length > 100) {
      throw new RequestValidationError('displayName must be between 1 and 100 characters');
    }
    try {
      validateManagedUsername(username);
      validateManagedPassword(password);
    } catch (error) {
      throw new RequestValidationError(error instanceof Error ? error.message : 'Invalid account details.');
    }
    const staffId = await createManagedStaffAccount(
      authenticatedStaff(request).staffId,
      displayName,
      username,
      password,
      role,
      parsePositiveIntegerArray(body.servicePointIds, 'servicePointIds')
    );
    response.status(201).json({ staffId });
  });

  app.post('/api/admin/staff/:staffId', ...adminOnly, async (request, response) => {
    const staffId = parsePositiveInteger(request.params.staffId, 'staffId');
    const body = parseBodyObject(request.body);
    const displayName = parseString(body.displayName, 'displayName').trim();
    const username = parseString(body.username, 'username');
    const role = body.role;
    if (role !== 'ADMIN' && role !== 'STAFF') {
      throw new RequestValidationError('role must be ADMIN or STAFF');
    }
    if (!displayName || displayName.length > 100) {
      throw new RequestValidationError('displayName must be between 1 and 100 characters');
    }
    let normalizedUsername: string;
    try {
      normalizedUsername = validateManagedUsername(username);
    } catch (error) {
      throw new RequestValidationError(error instanceof Error ? error.message : 'Invalid username.');
    }
    await updateManagedStaffAccount(
      authenticatedStaff(request).staffId,
      staffId,
      displayName,
      normalizedUsername,
      parseBoolean(body.isActive, 'isActive'),
      role,
      parsePositiveIntegerArray(body.servicePointIds, 'servicePointIds')
    );
    response.status(204).end();
  });

  app.post('/api/queues/today', async (request, response) => {
    const body = parseBodyObject(request.body);
    const queueDate = parseQueueDate(body.queueDate);
    const queueId = await openDailyQueue(queueDate);
    response.status(200).json({ queueId, queueDate, status: 'OPEN' });
  });

  app.post('/api/queues/:queueId/tickets', async (request, response) => {
    const queueId = parsePositiveInteger(request.params.queueId, 'queueId');
    const body = parseBodyObject(request.body);
    const serviceTypeId = parsePositiveInteger(body.serviceTypeId, 'serviceTypeId');
    if (body.requeuedFromTicketId !== undefined) {
      throw new RequestValidationError('Only signed-in staff can rejoin a no-show ticket');
    }
    const ticket = await checkInWalkIn(queueId, serviceTypeId);
    response.status(201).json({
      ...ticket,
      ticketNumber: String(ticket.sequenceNumber).padStart(3, '0'),
      status: 'WAITING'
    });
  });

  app.post('/api/staff/queues/:queueId/tickets', staffOnly, async (request, response) => {
    const queueId = parsePositiveInteger(request.params.queueId, 'queueId');
    const body = parseBodyObject(request.body);
    const serviceTypeId = parsePositiveInteger(body.serviceTypeId, 'serviceTypeId');
    const requeuedFromTicketId =
      body.requeuedFromTicketId === undefined
        ? undefined
        : parsePositiveInteger(body.requeuedFromTicketId, 'requeuedFromTicketId');
    const staffId = authenticatedStaff(request).staffId;
    const ticket = await checkInWalkIn(queueId, serviceTypeId, requeuedFromTicketId, staffId);
    response.status(201).json({
      ...ticket,
      ticketNumber: String(ticket.sequenceNumber).padStart(3, '0'),
      status: 'WAITING'
    });
  });

  app.get('/api/queues/:queueId/tickets', async (request, response) => {
    const queueId = parsePositiveInteger(request.params.queueId, 'queueId');
    response.json({ tickets: await getWaitingTickets(queueId) });
  });

  app.get('/api/staff/service-stations', staffOnly, async (request, response) => {
    const staffId = authenticatedStaff(request).staffId;
    response.json({ servicePoints: await getActiveServicePoints(staffId) });
  });

  app.get('/api/queues/:queueId/active-tickets', async (request, response) => {
    const queueId = parsePositiveInteger(request.params.queueId, 'queueId');
    response.json({ tickets: await getActiveTickets(queueId) });
  });

  app.get('/api/queues/:queueId/no-show-tickets', staffOnly, async (request, response) => {
    const queueId = parsePositiveInteger(request.params.queueId, 'queueId');
    response.json({ tickets: await getNoShowTickets(queueId) });
  });

  app.get('/api/staff/queues/:queueId/activity', staffOnly, requireAdmin, async (request, response) => {
    const queueId = parsePositiveInteger(request.params.queueId, 'queueId');
    response.json({ events: await getStaffActivity(queueId) });
  });

  app.post('/api/queues/:queueId/call-next', staffOnly, async (request, response) => {
    const queueId = parsePositiveInteger(request.params.queueId, 'queueId');
    const body = parseBodyObject(request.body);
    const servicePointId = parsePositiveInteger(body.servicePointId, 'servicePointId');
    const ticket = await callNextTicket(
      queueId,
      servicePointId,
      authenticatedStaff(request).staffId
    );
    if (!ticket) {
      response.status(204).end();
      return;
    }

    response.json({
      ...ticket,
      ticketNumber: String(ticket.sequenceNumber).padStart(3, '0'),
      status: 'CALLED'
    });
  });

  app.post('/api/tickets/:ticketId/call-outcomes', staffOnly, async (request, response) => {
    const ticketId = parsePositiveInteger(request.params.ticketId, 'ticketId');
    const body = parseBodyObject(request.body);
    const attemptNumber = parsePositiveInteger(body.attemptNumber, 'attemptNumber');
    if (attemptNumber !== 1 && attemptNumber !== 2) {
      throw new RequestValidationError('attemptNumber must be 1 or 2');
    }

    const outcome = parseCallOutcome(body.outcome);
    await recordCallOutcome(
      ticketId,
      attemptNumber,
      outcome,
      authenticatedStaff(request).staffId
    );
    response.status(204).end();
  });

  app.post('/api/tickets/:ticketId/repeat-call', staffOnly, async (request, response) => {
    const ticketId = parsePositiveInteger(request.params.ticketId, 'ticketId');
    const callAttemptId = await repeatCall(
      ticketId,
      authenticatedStaff(request).staffId
    );
    response.status(201).json({ callAttemptId, ticketId, attemptNumber: 2 });
  });

  app.post('/api/tickets/:ticketId/no-show', staffOnly, async (request, response) => {
    const ticketId = parsePositiveInteger(request.params.ticketId, 'ticketId');
    await markNoShow(ticketId, authenticatedStaff(request).staffId);
    response.status(204).end();
  });

  app.post('/api/tickets/:ticketId/return-to-queue', staffOnly, async (request, response) => {
    const ticketId = parsePositiveInteger(request.params.ticketId, 'ticketId');
    await returnCalledTicketToQueue(ticketId, authenticatedStaff(request).staffId);
    response.status(204).end();
  });

  app.post('/api/tickets/:ticketId/start', staffOnly, async (request, response) => {
    const ticketId = parsePositiveInteger(request.params.ticketId, 'ticketId');
    const body = parseBodyObject(request.body);
    const servicePointId = parsePositiveInteger(body.servicePointId, 'servicePointId');
    await startService(ticketId, servicePointId, authenticatedStaff(request).staffId);
    response.status(204).end();
  });

  app.post('/api/tickets/:ticketId/complete', staffOnly, async (request, response) => {
    const ticketId = parsePositiveInteger(request.params.ticketId, 'ticketId');
    await completeService(ticketId, authenticatedStaff(request).staffId);
    response.status(204).end();
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'API route not found' }
    });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof RequestValidationError) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: error.message }
      });
      return;
    }

    if (error instanceof QueueError) {
      response.status(409).json({
        error: { code: 'QUEUE_CONFLICT', message: error.message }
      });
      return;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_ROW_IS_REFERENCED_2')
    ) {
      response.status(409).json({
        error: {
          code: 'CONFIGURATION_CONFLICT',
          message:
            error.code === 'ER_DUP_ENTRY'
              ? 'That name or username is already in use.'
              : 'This item is still referenced by existing queue history and cannot be removed.'
        }
      });
      return;
    }

    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' }
      });
      return;
    }

    console.error('Unhandled API error', error);
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred' }
    });
  };
  app.use(errorHandler);

  return app;
}
