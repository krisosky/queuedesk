import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ServiceTypeOption {
  serviceTypeId: number;
  name: string;
}

export interface StaffOption {
  staffId: number;
  displayName: string;
}

export interface ServicePointOption {
  servicePointId: number;
  name: string;
  serviceTypeIds: number[];
}

export interface QueueCatalog {
  serviceTypes: ServiceTypeOption[];
  staff: StaffOption[];
  servicePoints: ServicePointOption[];
  ticketPrintingEnabled: boolean;
}

export interface AdminService {
  serviceTypeId: number;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface AdminServicePoint {
  servicePointId: number;
  name: string;
  isActive: boolean;
  serviceTypeIds: number[];
}

export interface AdminStaffAccount {
  staffId: number;
  displayName: string;
  username: string | null;
  role: 'ADMIN' | 'STAFF' | null;
  isActive: boolean;
  hasAccount: boolean;
  servicePointIds: number[];
  stats: StaffStats;
  currentServiceStations: string[];
}

export interface AdminConfiguration {
  services: AdminService[];
  servicePoints: AdminServicePoint[];
  staff: AdminStaffAccount[];
  ticketPrintingEnabled: boolean;
}

export interface AdminStaffStatsRow {
  staffId: number;
  stats: StaffStats;
  currentServiceStations: string[];
}

export interface StaffIdentity {
  staffId: number;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'STAFF';
}

export interface StaffAuditEvent {
  auditEventId: number;
  eventType:
    | 'ASSISTED_CHECK_IN'
    | 'REJOINED_TICKET'
    | 'CALLED_TICKET'
    | 'CALL_ACKNOWLEDGED'
    | 'CALL_NO_RESPONSE'
    | 'REPEATED_CALL'
    | 'MARKED_NO_SHOW'
    | 'SERVICE_STARTED'
    | 'SERVICE_COMPLETED'
    | 'SERVICE_CREATED'
    | 'SERVICE_UPDATED'
    | 'SERVICE_POINT_CREATED'
    | 'SERVICE_POINT_UPDATED'
    | 'SERVICE_POINT_SERVICES_UPDATED'
    | 'STAFF_ACCOUNT_CREATED'
    | 'STAFF_ACCOUNT_UPDATED'
    | 'TICKET_RETURNED_TO_QUEUE';
  staffName: string;
  sequenceNumber: number | null;
  servicePointName: string | null;
  subjectName: string | null;
  createdAt: string;
}

export interface QueueInfo {
  queueId: number;
  queueDate: string;
  status: 'OPEN' | 'CLOSED';
}

export interface StaffStats {
  totalLoginSeconds: number;
  ticketsCompleted: number;
  noShows: number;
  ticketsReturned: number;
  byServicePoint: StaffServicePointStats[];
}

export interface StaffServicePointStats {
  servicePointId: number;
  servicePointName: string;
  ticketsCompleted: number;
  noShows: number;
  ticketsReturned: number;
}

export interface QueueTicket {
  ticketId: number;
  sequenceNumber: number;
  serviceTypeName: string;
  checkedInAt?: string;
  status?: 'WAITING' | 'CALLED' | 'IN_SERVICE';
  attemptNumber?: number;
  callOutcome?: 'PENDING' | 'ACKNOWLEDGED' | 'NO_RESPONSE';
  staffId?: number;
  ticketNumber?: string;
  staffName?: string;
  serviceTypeId?: number;
  servicePointId?: number | null;
  servicePointName?: string;
}

@Injectable({ providedIn: 'root' })
export class QueueApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  getCatalog(): Promise<QueueCatalog> {
    return firstValueFrom(this.http.get<QueueCatalog>(`${this.baseUrl}/catalog`));
  }

  getAssignedServicePoints(): Promise<ServicePointOption[]> {
    return firstValueFrom(
      this.http.get<{ servicePoints: ServicePointOption[] }>(
        `${this.baseUrl}/staff/service-stations`
      )
    ).then((result) => result.servicePoints);
  }

  getMyStats(): Promise<StaffStats> {
    return firstValueFrom(
      this.http.get<StaffStats>(`${this.baseUrl}/staff/my-stats`)
    );
  }

  setMyCurrentStation(servicePointId: number): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.baseUrl}/staff/current-station`, { servicePointId })
    );
  }

  getMyCurrentStation(): Promise<{ servicePointId: number | null }> {
    return firstValueFrom(
      this.http.get<{ servicePointId: number | null }>(`${this.baseUrl}/staff/current-station`)
    );
  }

  openToday(queueDate: string): Promise<QueueInfo> {
    return firstValueFrom(
      this.http.post<QueueInfo>(`${this.baseUrl}/queues/today`, { queueDate })
    );
  }

  getWaiting(queueId: number): Promise<QueueTicket[]> {
    return firstValueFrom(
      this.http.get<{ tickets: QueueTicket[] }>(
        `${this.baseUrl}/queues/${queueId}/tickets`
      )
    ).then((result) => result.tickets);
  }

  getActive(queueId: number): Promise<QueueTicket[]> {
    return firstValueFrom(
      this.http.get<{ tickets: QueueTicket[] }>(
        `${this.baseUrl}/queues/${queueId}/active-tickets`
      )
    ).then((result) => result.tickets);
  }

  getNoShows(queueId: number): Promise<QueueTicket[]> {
    return firstValueFrom(
      this.http.get<{ tickets: QueueTicket[] }>(
        `${this.baseUrl}/queues/${queueId}/no-show-tickets`
      )
    ).then((result) => result.tickets);
  }

  getStaffActivity(queueId: number): Promise<StaffAuditEvent[]> {
    return firstValueFrom(
      this.http.get<{ events: StaffAuditEvent[] }>(
        `${this.baseUrl}/staff/queues/${queueId}/activity`
      )
    ).then((result) => result.events);
  }

  getAdminConfiguration(): Promise<AdminConfiguration> {
    return firstValueFrom(
      this.http.get<AdminConfiguration>(`${this.baseUrl}/admin/configuration`)
    );
  }

  setTicketPrintingEnabled(enabled: boolean): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.baseUrl}/admin/settings/ticket-printing`, { enabled })
    );
  }

  getAdminStaffStats(): Promise<AdminStaffStatsRow[]> {
    return firstValueFrom(
      this.http.get<{ staffStats: AdminStaffStatsRow[] }>(
        `${this.baseUrl}/admin/staff-stats`
      )
    ).then((result) => result.staffStats);
  }

  createAdminService(name: string, description: string | null): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/admin/services`, { name, description })
    );
  }

  updateAdminService(service: AdminService): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/admin/services/${service.serviceTypeId}`, service)
    );
  }

  createAdminServicePoint(name: string): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/admin/service-points`, { name })
    );
  }

  updateAdminServicePoint(point: AdminServicePoint): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(
        `${this.baseUrl}/admin/service-points/${point.servicePointId}`,
        point
      )
    );
  }

  updateAdminPointServices(servicePointId: number, serviceTypeIds: number[]): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/admin/service-points/${servicePointId}/services`, {
        serviceTypeIds
      })
    );
  }

  createAdminStaffAccount(
    displayName: string,
    username: string,
    password: string,
    role: 'ADMIN' | 'STAFF',
    servicePointIds: number[]
  ): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/admin/staff`, {
        displayName,
        username,
        password,
        role,
        servicePointIds
      })
    );
  }

  updateAdminStaffAccount(staff: AdminStaffAccount): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/admin/staff/${staff.staffId}`, staff)
    );
  }

  checkIn(queueId: number, serviceTypeId: number): Promise<QueueTicket> {
    return firstValueFrom(
      this.http.post<QueueTicket>(`${this.baseUrl}/queues/${queueId}/tickets`, {
        serviceTypeId
      })
    );
  }

  assistedCheckIn(
    queueId: number,
    serviceTypeId: number,
    requeuedFromTicketId?: number
  ): Promise<QueueTicket> {
    return firstValueFrom(
      this.http.post<QueueTicket>(`${this.baseUrl}/staff/queues/${queueId}/tickets`, {
        serviceTypeId,
        ...(requeuedFromTicketId === undefined ? {} : { requeuedFromTicketId })
      })
    );
  }

  login(username: string, password: string): Promise<StaffIdentity> {
    return firstValueFrom(
      this.http
        .post<{ staff: StaffIdentity }>(`${this.baseUrl}/auth/login`, { username, password })
    ).then((result) => result.staff);
  }

  getCurrentStaff(): Promise<StaffIdentity> {
    return firstValueFrom(
      this.http.get<{ staff: StaffIdentity }>(`${this.baseUrl}/auth/me`)
    ).then((result) => result.staff);
  }

  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.baseUrl}/auth/logout`, {}));
  }

  callNext(queueId: number, servicePointId: number): Promise<QueueTicket | null> {
    return firstValueFrom(
      this.http.post<QueueTicket | null>(
        `${this.baseUrl}/queues/${queueId}/call-next`,
        { servicePointId }
      )
    );
  }

  recordCallOutcome(
    ticketId: number,
    attemptNumber: number,
    outcome: 'ACKNOWLEDGED' | 'NO_RESPONSE'
  ): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/tickets/${ticketId}/call-outcomes`, {
        attemptNumber,
        outcome
      })
    );
  }

  repeatCall(ticketId: number): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/tickets/${ticketId}/repeat-call`, {})
    );
  }

  markNoShow(ticketId: number): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/tickets/${ticketId}/no-show`, {})
    );
  }

  returnTicketToQueue(ticketId: number): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/tickets/${ticketId}/return-to-queue`, {})
    );
  }

  startService(ticketId: number, servicePointId: number): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/tickets/${ticketId}/start`, { servicePointId })
    );
  }

  completeService(ticketId: number): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/tickets/${ticketId}/complete`, {})
    );
  }

  static errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.error?.message;
      if (typeof message === 'string') {
        return message;
      }
      if (error.status === 401) {
        return 'Your staff session has ended. Please sign in again.';
      }
      if (error.status === 0) {
        return 'Cannot reach the queue server. Check that the API is running.';
      }
    }

    return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  }
}
