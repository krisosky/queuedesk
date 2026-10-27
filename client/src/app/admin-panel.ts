import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  QueueApi,
  type AdminConfiguration,
  type AdminService,
  type AdminServicePoint,
  type AdminStaffAccount,
  type QueueInfo,
  type StaffAuditEvent
} from './queue-api';
import { StaffAuth } from './staff-auth';

@Component({
  selector: 'app-admin-panel',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-panel.html',
  styleUrl: './admin-panel.css'
})
export class AdminPanel implements OnInit {
  private readonly api = inject(QueueApi);
  protected readonly auth = inject(StaffAuth);
  protected readonly config = signal<AdminConfiguration>({
    services: [],
    servicePoints: [],
    staff: [],
    ticketPrintingEnabled: false
  });
  protected readonly activeStaffAccounts = computed(() =>
    this.config().staff.filter((staff) => staff.isActive)
  );
  protected readonly inactiveStaffAccounts = computed(() =>
    this.config().staff.filter((staff) => !staff.isActive)
  );
  protected readonly staffPendingDeactivation = signal<AdminStaffAccount | null>(null);
  protected readonly activity = signal<StaffAuditEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly staffStatsError = signal('');
  protected readonly pointServiceDrafts = signal<Record<number, number[]>>({});
  protected originalTicketPrintingEnabled = false;
  protected serviceName = '';
  protected serviceDescription = '';
  protected servicePointName = '';
  protected staffName = '';
  protected staffUsername = '';
  protected staffPassword = '';
  protected staffRole: 'ADMIN' | 'STAFF' = 'STAFF';
  protected staffServicePointIds: number[] = [];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async createService(): Promise<void> {
    await this.perform('Service added.', async () => {
      await this.api.createAdminService(
        this.serviceName,
        this.serviceDescription.trim() || null
      );
      this.serviceName = '';
      this.serviceDescription = '';
    }, true);
  }

  protected async saveService(service: AdminService): Promise<void> {
    await this.perform(`${service.name} saved.`, () => this.api.updateAdminService(service));
  }

  protected async createServicePoint(): Promise<void> {
    await this.perform('Service point added.', async () => {
      await this.api.createAdminServicePoint(this.servicePointName);
      this.servicePointName = '';
    });
  }

  protected async saveServicePoint(point: AdminServicePoint): Promise<void> {
    await this.perform(`${point.name} saved.`, () => this.api.updateAdminServicePoint(point));
  }

  protected async saveTicketPrinting(): Promise<void> {
    const enabled = this.config().ticketPrintingEnabled;
    await this.perform(
      enabled ? 'Kiosk ticket printing enabled.' : 'Kiosk ticket printing disabled.',
      () => this.api.setTicketPrintingEnabled(enabled)
    );
  }

  protected setTicketPrintingDraft(enabled: boolean): void {
    this.config.update((current) => ({ ...current, ticketPrintingEnabled: enabled }));
  }

  protected testTicketPrint(): void {
    window.print();
  }

  protected serviceSelected(pointId: number, serviceId: number): boolean {
    return (this.pointServiceDrafts()[pointId] ?? []).includes(serviceId);
  }

  protected toggleService(pointId: number, serviceId: number, selected: boolean): void {
    const current = this.pointServiceDrafts()[pointId] ?? [];
    const updated = selected
      ? [...new Set([...current, serviceId])]
      : current.filter((id) => id !== serviceId);
    this.pointServiceDrafts.update((drafts) => ({ ...drafts, [pointId]: updated }));
  }

  protected async savePointServices(point: AdminServicePoint): Promise<void> {
    const serviceTypeIds = this.pointServiceDrafts()[point.servicePointId] ?? [];
    await this.perform(
      `Services for ${point.name} saved.`,
      () => this.api.updateAdminPointServices(point.servicePointId, serviceTypeIds)
    );
  }

  protected async createStaff(): Promise<void> {
    await this.perform('Staff account created.', async () => {
      await this.api.createAdminStaffAccount(
        this.staffName,
        this.staffUsername,
        this.staffPassword,
        this.staffRole,
        this.staffServicePointIds
      );
      this.staffName = '';
      this.staffUsername = '';
      this.staffPassword = '';
      this.staffRole = 'STAFF';
      this.staffServicePointIds = [];
    });
  }

  protected async saveStaff(staff: AdminStaffAccount): Promise<void> {
    await this.perform(
      `Account for ${staff.displayName} saved.`,
      () => this.api.updateAdminStaffAccount(staff)
    );
  }

  protected async deactivateStaff(staff: AdminStaffAccount): Promise<void> {
    this.staffPendingDeactivation.set(staff);
  }

  protected cancelStaffDeactivation(): void {
    this.staffPendingDeactivation.set(null);
  }

  protected async confirmStaffDeactivation(): Promise<void> {
    const staff = this.staffPendingDeactivation();
    if (!staff) {
      return;
    }
    this.staffPendingDeactivation.set(null);
    await this.saveStaff({ ...staff, isActive: false });
  }

  protected async reactivateStaff(staff: AdminStaffAccount): Promise<void> {
    await this.saveStaff({ ...staff, isActive: true });
  }

  protected setStaffUsername(staff: AdminStaffAccount, username: string): void {
    staff.username = username;
  }

  protected staffServicePointSelected(staff: AdminStaffAccount, servicePointId: number): boolean {
    return staff.servicePointIds.includes(servicePointId);
  }

  protected toggleStaffServicePoint(
    staff: AdminStaffAccount,
    servicePointId: number,
    selected: boolean
  ): void {
    staff.servicePointIds = selected
      ? [...new Set([...staff.servicePointIds, servicePointId])]
      : staff.servicePointIds.filter((id) => id !== servicePointId);
  }

  protected toggleNewStaffServicePoint(servicePointId: number, selected: boolean): void {
    this.staffServicePointIds = selected
      ? [...new Set([...this.staffServicePointIds, servicePointId])]
      : this.staffServicePointIds.filter((id) => id !== servicePointId);
  }

  protected async reload(preserveRoutingDrafts = false): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const config = await this.api.getAdminConfiguration();
      this.config.set(config);
      this.originalTicketPrintingEnabled = config.ticketPrintingEnabled;
      const persistedDrafts = Object.fromEntries(
        config.servicePoints.map((point) => [point.servicePointId, [...point.serviceTypeIds]])
      );
      this.pointServiceDrafts.set(
        preserveRoutingDrafts
          ? { ...persistedDrafts, ...this.pointServiceDrafts() }
          : persistedDrafts
      );
      const queue = await this.api.openToday(this.localDate());
      this.activity.set(await this.api.getStaffActivity(queue.queueId));
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  protected formatDuration(totalSeconds: number): string {
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  protected formatEvent(event: StaffAuditEvent): string {
    const descriptions: Record<StaffAuditEvent['eventType'], string> = {
      ASSISTED_CHECK_IN: 'assisted with check-in',
      REJOINED_TICKET: 'rejoined a ticket',
      CALLED_TICKET: 'called a ticket',
      CALL_ACKNOWLEDGED: 'recorded a response',
      CALL_NO_RESPONSE: 'recorded no response',
      REPEATED_CALL: 'repeated a call',
      MARKED_NO_SHOW: 'marked a no-show',
      SERVICE_STARTED: 'started service',
      SERVICE_COMPLETED: 'completed service',
      SERVICE_CREATED: 'created a service',
      SERVICE_UPDATED: 'updated a service',
      SERVICE_POINT_CREATED: 'created a service point',
      SERVICE_POINT_UPDATED: 'updated a service point',
      SERVICE_POINT_SERVICES_UPDATED: 'changed service-point routing',
      STAFF_ACCOUNT_CREATED: 'created a staff account',
      STAFF_ACCOUNT_UPDATED: 'updated a staff account',
      TICKET_RETURNED_TO_QUEUE: 'returned a ticket to the front of the queue'
    };
    return descriptions[event.eventType];
  }

  private async load(): Promise<void> {
    await this.reload();
  }

  protected async refreshStaffStats(): Promise<void> {
    try {
      const stats = await this.api.getAdminStaffStats();
      const statsByStaffId = new Map(stats.map((row) => [row.staffId, row]));
      this.config.update((config) => ({
        ...config,
        staff: config.staff.map((staff) => {
          const currentStats = statsByStaffId.get(staff.staffId);
          return currentStats
            ? {
                ...staff,
                currentServiceStations: currentStats.currentServiceStations,
                stats: currentStats.stats
              }
            : staff;
        })
      }));
      this.staffStatsError.set('');
    } catch (error) {
      this.staffStatsError.set(QueueApi.errorMessage(error));
    }
  }

  private async perform(
    successMessage: string,
    action: () => Promise<unknown>,
    preserveRoutingDrafts = false
  ): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await action();
      this.notice.set(successMessage);
      await this.reload(preserveRoutingDrafts);
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    } finally {
      this.saving.set(false);
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
