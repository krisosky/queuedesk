import type { Request, RequestHandler } from 'express';
import {
  getStaffForSession,
  type AuthenticatedStaff
} from './models/staff-auth.model.js';

declare module 'express-serve-static-core' {
  interface Request {
    staff?: AuthenticatedStaff;
  }
}

export const SESSION_COOKIE_NAME = 'queue_staff_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export class AuthenticationError extends Error {
  constructor(message = 'Staff sign-in is required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export function sessionCookie(token: string): string {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`;
}

export function sessionTokenFromRequest(request: { headers: { cookie?: string } }): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  const token = cookie?.slice(SESSION_COOKIE_NAME.length + 1);
  return token && /^[A-Za-z0-9_-]{40,60}$/.test(token) ? token : null;
}

export function requireStaff(): RequestHandler {
  return async (request, response, next) => {
    try {
      const token = sessionTokenFromRequest(request);
      const staff: AuthenticatedStaff | null = token
        ? await getStaffForSession(token)
        : null;
      if (!staff) {
        response.status(401).json({
          error: { code: 'AUTHENTICATION_REQUIRED', message: 'Please sign in to use staff operations.' }
        });
        return;
      }
      request.staff = staff;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function authenticatedStaff(request: Request): AuthenticatedStaff {
  if (!request.staff) {
    throw new AuthenticationError();
  }
  return request.staff;
}

export const requireAdmin: RequestHandler = (request, response, next) => {
  const staff = request.staff;
  if (!staff) {
    response.status(401).json({
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'Please sign in to continue.' }
    });
    return;
  }
  if (staff.role !== 'ADMIN') {
    response.status(403).json({
      error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' }
    });
    return;
  }
  next();
};
