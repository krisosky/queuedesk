import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { QueueApi, type QueueTicket, type ServiceTypeOption } from './queue-api';

@Component({
  selector: 'app-kiosk',
  imports: [CommonModule],
  templateUrl: './kiosk.html',
  styleUrl: './kiosk.css'
})
export class Kiosk implements OnInit {
  private readonly api = inject(QueueApi);

  protected readonly services = signal<ServiceTypeOption[]>([]);
  protected readonly loading = signal(true);
  protected readonly working = signal(false);
  protected readonly error = signal('');
  protected readonly ticket = signal<QueueTicket | null>(null);
  protected readonly ticketPrintingEnabled = signal(false);
  protected readonly serviceTypes = computed(() => this.services());

  async ngOnInit(): Promise<void> {
    await this.loadServices();
  }

  protected async retry(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    await this.loadServices();
  }

  private async loadServices(): Promise<void> {
    try {
      const [catalog] = await Promise.all([
        this.api.getCatalog(),
        this.api.openToday(this.localDate())
      ]);
      const availableServiceIds = new Set(
        catalog.servicePoints.flatMap((point) => point.serviceTypeIds)
      );
      this.ticketPrintingEnabled.set(catalog.ticketPrintingEnabled);
      this.services.set(
        catalog.serviceTypes.filter((service) => availableServiceIds.has(service.serviceTypeId))
      );
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async chooseService(service: ServiceTypeOption): Promise<void> {
    if (this.working()) {
      return;
    }

    this.working.set(true);
    this.error.set('');
    try {
      const queue = await this.api.openToday(this.localDate());
      this.ticket.set(await this.api.checkIn(queue.queueId, service.serviceTypeId));
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  protected startOver(): void {
    this.ticket.set(null);
  }

  protected printTicket(): void {
    if (this.ticket() && this.ticketPrintingEnabled()) {
      window.print();
    }
  }

  protected formatTicket(ticket: QueueTicket): string {
    return String(ticket.sequenceNumber).padStart(3, '0');
  }

  private localDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
