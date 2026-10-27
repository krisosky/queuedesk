import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  QueueApi,
  type StaffAuditEvent,
  type QueueInfo,
  type QueueTicket,
  type ServicePointOption,
  type StaffStats
} from './queue-api';
import { StaffAuth } from './staff-auth';

@Component({
  selector: 'app-service-desk',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './service-desk.html',
  styleUrl: './service-desk.css'
})
export class ServiceDesk implements OnInit, OnDestroy {
  private readonly api = inject(QueueApi);
  protected readonly auth = inject(StaffAuth);
  private readonly router = inject(Router);
  private pollHandle: number | undefined;
  private statsPollHandle: number | undefined;
  private isRefreshing = false;
  private isUpdatingStation = false;

  protected readonly queue = signal<QueueInfo | null>(null);
  protected readonly services = signal<{ serviceTypeId: number; name: string }[]>([]);
  protected readonly servicePoints = signal<ServicePointOption[]>([]);
  protected readonly waitingTickets = signal<QueueTicket[]>([]);
  protected readonly activeTickets = signal<QueueTicket[]>([]);
  protected readonly noShowTickets = signal<QueueTicket[]>([]);
  protected readonly staffActivity = signal<StaffAuditEvent[]>([]);
  protected readonly myStats = signal<StaffStats>({
    totalLoginSeconds: 0,
    ticketsCompleted: 0,
    noShows: 0,
    ticketsReturned: 0,
    byServicePoint: []
  });
  protected readonly myStatsLoaded = signal(false);
  protected readonly statsError = signal('');
  protected readonly currentStationSaved = signal(false);
  protected readonly loading = signal(true);
  protected readonly working = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected serviceTypeId: number | null = null;
  private readonly selectedServicePointId = signal<number | null>(null);

  protected get servicePointId(): number | null {
    return this.selectedServicePointId();
  }

  protected set servicePointId(value: number | null) {
    this.selectedServicePointId.set(value);
  }

  protected readonly selectedStaffTicket = computed(
    () =>
      this.activeTickets().find(
        (ticket) =>
          ticket.servicePointId === this.servicePointId && ticket.status === 'CALLED'
      ) ?? null
  );

  protected readonly selectedStaffInService = computed(
    () =>
      this.activeTickets().find(
        (ticket) =>
          ticket.servicePointId === this.servicePointId && ticket.status === 'IN_SERVICE'
      ) ?? null
  );

  protected readonly isReady = computed(
    () => this.services().length > 0 && this.servicePoints().some((point) => point.serviceTypeIds.length > 0)
  );

  protected readonly eligibleWaitingTickets = computed(() => {
    const selectedPoint = this.servicePoints().find(
      (point) => point.servicePointId === this.servicePointId
    );
    if (!selectedPoint) {
      return [];
    }

    return this.waitingTickets().filter((ticket) =>
      selectedPoint.serviceTypeIds.includes(ticket.serviceTypeId ?? 0)
    );
  });

  protected get selectedServicePoint(): ServicePointOption | undefined {
    return this.servicePoints().find((point) => point.servicePointId === this.servicePointId);
  }

  protected get isStationUpdating(): boolean {
    return this.isUpdatingStation;
  }

  protected servicesForPoint(point: ServicePointOption): string {
    const serviceNames = new Map(
      this.services().map((service) => [service.serviceTypeId, service.name])
    );
    return point.serviceTypeIds
      .map((serviceTypeId) => serviceNames.get(serviceTypeId))
      .filter((name): name is string => name !== undefined)
      .join(', ');
  }

  protected async setSelectedServicePoint(value: number | null): Promise<void> {
    if (this.isUpdatingStation || this.selectedStaffTicket() || this.selectedStaffInService()) {
      return;
    }
    this.servicePointId = value;
    this.currentStationSaved.set(false);
    if (value === null) {
      return;
    }

    this.isUpdatingStation = true;
    try {
      await this.api.setMyCurrentStation(value);
      this.currentStationSaved.set(true);
      this.error.set('');
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.auth.clearLocalSession();
        await this.router.navigateByUrl('/staff-login');
      }
    } finally {
      this.isUpdatingStation = false;
    }
  }

  async ngOnInit(): Promise<void> {
    await this.initialize();
    this.pollHandle = window.setInterval(() => void this.refresh(), 4000);
    this.statsPollHandle = window.setInterval(() => void this.refreshMyStats(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
    }
    if (this.statsPollHandle !== undefined) {
      window.clearInterval(this.statsPollHandle);
    }
  }

  protected async checkIn(): Promise<void> {
    const queue = this.queue();
    if (!queue || this.serviceTypeId === null) {
      return;
    }

    await this.perform(async () => {
      const ticket = await this.api.assistedCheckIn(queue.queueId, this.serviceTypeId!);
      this.notice.set(`Ticket ${this.formatTicket(ticket.sequenceNumber)} added to the queue.`);
      await this.refresh();
    });
  }

  protected async rejoinQueue(ticket: QueueTicket): Promise<void> {
    const queue = this.queue();
    if (!queue || ticket.serviceTypeId === undefined) {
      return;
    }

    await this.perform(async () => {
      const newTicket = await this.api.assistedCheckIn(
        queue.queueId,
        ticket.serviceTypeId!,
        ticket.ticketId
      );
      this.notice.set(
        `Ticket ${this.formatTicket(ticket.sequenceNumber)} rejoined as ${this.formatTicket(newTicket.sequenceNumber)} at the end of the line.`
      );
      await this.refresh();
    });
  }

  protected async callNext(): Promise<void> {
    const queue = this.queue();
    if (!queue || this.servicePointId === null) {
      return;
    }

    await this.perform(async () => {
      const ticket = await this.api.callNext(queue.queueId, this.servicePointId!);
      this.notice.set(
        ticket
          ? `Ticket ${this.formatTicket(ticket.sequenceNumber)} has been called.`
          : 'There are no waiting tickets this service point can handle.'
      );
      await this.refresh();
    });
  }

  protected async markPresent(ticket: QueueTicket): Promise<void> {
    const servicePointId = this.servicePointId;
    if (servicePointId === null || ticket.attemptNumber === undefined) {
      return;
    }

    await this.perform(async () => {
      if (ticket.callOutcome !== 'ACKNOWLEDGED') {
        await this.api.recordCallOutcome(ticket.ticketId, ticket.attemptNumber!, 'ACKNOWLEDGED');
      }
      await this.api.startService(ticket.ticketId, servicePointId);
      this.notice.set(`Service started for ticket ${this.formatTicket(ticket.sequenceNumber)}.`);
      await this.refresh();
    });
  }

  protected async recordNoResponse(ticket: QueueTicket): Promise<void> {
    if (ticket.attemptNumber === undefined) {
      return;
    }

    await this.perform(async () => {
      await this.api.recordCallOutcome(ticket.ticketId, ticket.attemptNumber!, 'NO_RESPONSE');
      this.notice.set(`No response recorded for ticket ${this.formatTicket(ticket.sequenceNumber)}.`);
      await this.refresh();
    });
  }

  protected async repeatCall(ticket: QueueTicket): Promise<void> {
    await this.perform(async () => {
      await this.api.repeatCall(ticket.ticketId);
      this.notice.set(`Ticket ${this.formatTicket(ticket.sequenceNumber)} has been called again.`);
      await this.refresh();
    });
  }

  protected async markNoShow(ticket: QueueTicket): Promise<void> {
    await this.perform(async () => {
      await this.api.markNoShow(ticket.ticketId);
      this.notice.set(`Ticket ${this.formatTicket(ticket.sequenceNumber)} marked as no-show.`);
      await this.refresh();
    });
  }

  protected async returnToQueue(ticket: QueueTicket): Promise<void> {
    await this.perform(async () => {
      await this.api.returnTicketToQueue(ticket.ticketId);
      this.notice.set(
        `Ticket ${this.formatTicket(ticket.sequenceNumber)} returned to the front of its service queue.`
      );
      await this.refresh();
    });
  }

  protected async completeService(ticket: QueueTicket): Promise<void> {
    await this.perform(async () => {
      await this.api.completeService(ticket.ticketId);
      this.notice.set(`Ticket ${this.formatTicket(ticket.sequenceNumber)} completed.`);
      await this.refresh();
    });
  }

  protected async signOut(): Promise<void> {
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/staff-login');
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    }
  }

  protected activityDescription(event: StaffAuditEvent): string {
    const descriptions: Record<StaffAuditEvent['eventType'], string> = {
      ASSISTED_CHECK_IN: 'assisted with check-in for',
      REJOINED_TICKET: 'rejoined',
      CALLED_TICKET: 'called',
      CALL_ACKNOWLEDGED: 'recorded a response for',
      CALL_NO_RESPONSE: 'recorded no response for',
      REPEATED_CALL: 'called again',
      MARKED_NO_SHOW: 'marked as no-show',
      SERVICE_STARTED: 'started serving',
      SERVICE_COMPLETED: 'completed service for',
      SERVICE_CREATED: 'created service',
      SERVICE_UPDATED: 'updated service',
      SERVICE_POINT_CREATED: 'created service point',
      SERVICE_POINT_UPDATED: 'updated service point',
      SERVICE_POINT_SERVICES_UPDATED: 'updated services at',
      STAFF_ACCOUNT_CREATED: 'created staff account',
      STAFF_ACCOUNT_UPDATED: 'updated staff account',
      TICKET_RETURNED_TO_QUEUE: 'returned to the front of the queue'
    };
    return `${descriptions[event.eventType]}${event.subjectName ? ` ${event.subjectName}` : ''}`;
  }

  protected formatTicket(sequenceNumber: number): string {
    return String(sequenceNumber).padStart(3, '0');
  }

  protected formatDuration(totalSeconds: number): string {
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  protected formatTime(value: string | undefined): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  private async initialize(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const [catalog, assignedServicePoints, currentStation] = await Promise.all([
        this.api.getCatalog(),
        this.api.getAssignedServicePoints(),
        this.api.getMyCurrentStation()
      ]);
      this.servicePoints.set(assignedServicePoints);
      const availableServiceIds = new Set(
        assignedServicePoints.flatMap((point) => point.serviceTypeIds)
      );
      const availableServices = catalog.serviceTypes.filter((service) =>
        availableServiceIds.has(service.serviceTypeId)
      );
      this.services.set(availableServices);
      this.serviceTypeId = availableServices[0]?.serviceTypeId ?? null;
      this.servicePointId =
        assignedServicePoints.find(
          (point) => point.servicePointId === currentStation.servicePointId
        )?.servicePointId ??
        (assignedServicePoints.length === 1 ? assignedServicePoints[0].servicePointId : null);
      if (this.servicePointId !== null) {
        if (currentStation.servicePointId !== this.servicePointId) {
          await this.api.setMyCurrentStation(this.servicePointId);
        }
        this.currentStationSaved.set(true);
      }
      const queue = await this.api.openToday(this.localDate());
      this.queue.set(queue);
      await this.refresh();
      await this.refreshMyStats();
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.auth.clearLocalSession();
        await this.router.navigateByUrl('/staff-login');
      }

    } finally {
      this.loading.set(false);
    }
  }

  private async refreshMyStats(): Promise<void> {
    try {
      this.myStats.set(await this.api.getMyStats());
      this.myStatsLoaded.set(true);
      this.statsError.set('');
    } catch (error) {
      this.statsError.set(QueueApi.errorMessage(error));
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.auth.clearLocalSession();
        await this.router.navigateByUrl('/staff-login');
      }
    }
  }

  private async refresh(): Promise<void> {
    const queue = this.queue();
    if (!queue || this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    try {
      const [waiting, active, noShows] = await Promise.all([
        this.api.getWaiting(queue.queueId),
        this.api.getActive(queue.queueId),
        this.api.getNoShows(queue.queueId)
      ]);
      this.waitingTickets.set(waiting);
      this.activeTickets.set(active);
      this.noShowTickets.set(noShows);
      if (this.auth.staff()?.role === 'ADMIN') {
        this.staffActivity.set(await this.api.getStaffActivity(queue.queueId));
      } else {
        this.staffActivity.set([]);
      }
      this.error.set('');
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.auth.clearLocalSession();
        await this.router.navigateByUrl('/staff-login');
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    if (this.working()) {
      return;
    }

    this.working.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.auth.clearLocalSession();
        await this.router.navigateByUrl('/staff-login');
      }
    } finally {
      this.working.set(false);
    }
  }

  private localDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
