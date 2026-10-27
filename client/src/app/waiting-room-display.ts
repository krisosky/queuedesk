import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { QueueApi, type QueueInfo, type QueueTicket } from './queue-api';

@Component({
  selector: 'app-waiting-room-display',
  imports: [CommonModule],
  templateUrl: './waiting-room-display.html',
  styleUrl: './waiting-room-display.css'
})
export class WaitingRoomDisplay implements OnInit, OnDestroy {
  private readonly api = inject(QueueApi);
  private pollHandle: number | undefined;
  private isRefreshing = false;
  private hasInitialSnapshot = false;
  private previousCallAttempts = new Map<number, number>();

  protected readonly queue = signal<QueueInfo | null>(null);
  protected readonly activeTickets = signal<QueueTicket[]>([]);
  protected readonly waitingTickets = signal<QueueTicket[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly soundError = signal('');
  protected readonly announcement = signal('');
  protected readonly soundSupported = signal(
    typeof window !== 'undefined' && 'speechSynthesis' in window
  );
  protected readonly soundEnabled = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.queue.set(await this.api.openToday(this.localDate()));
      await this.refresh();
      this.pollHandle = window.setInterval(() => void this.refresh(), 4000);
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
    }
    if (this.soundSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  protected toggleSound(): void {
    if (!this.soundSupported()) {
      this.soundError.set('Audio announcements are not supported by this browser.');
      return;
    }

    if (this.soundEnabled()) {
      window.speechSynthesis.cancel();
      this.soundEnabled.set(false);
      this.soundError.set('');
      return;
    }

    this.soundError.set('');
    this.soundEnabled.set(true);
    this.speak('Sound announcements are enabled.');
  }

  protected formatTicket(sequenceNumber: number): string {
    return String(sequenceNumber).padStart(3, '0');
  }

  private async refresh(): Promise<void> {
    const queue = this.queue();
    if (!queue || this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    try {
      const [tickets, waiting] = await Promise.all([
        this.api.getActive(queue.queueId),
        this.api.getWaiting(queue.queueId)
      ]);
      const calledTickets = tickets.filter((ticket) => ticket.status === 'CALLED');
      const currentCallAttempts = new Map(
        calledTickets.map((ticket) => [ticket.ticketId, ticket.attemptNumber ?? 1])
      );
      const newlyCalled = this.hasInitialSnapshot
        ? calledTickets.filter(
            (ticket) =>
              !this.previousCallAttempts.has(ticket.ticketId) ||
              (ticket.attemptNumber ?? 1) >
                (this.previousCallAttempts.get(ticket.ticketId) ?? 0)
          )
        : [];
      if (newlyCalled.length > 0) {
        const message = newlyCalled
          .map(
            (ticket) =>
              `Ticket ${this.formatTicket(ticket.sequenceNumber)}, please proceed to ${ticket.servicePointName}.`
          )
          .join(' ');
        this.announcement.set(message);
        if (this.soundEnabled()) {
          for (const ticket of newlyCalled) {
            const spokenNumber = this.formatTicket(ticket.sequenceNumber).split('').join(' ');
            this.speak(
              `Ticket ${spokenNumber}. Please proceed to ${ticket.servicePointName}.`
            );
          }
        }
      }
      this.previousCallAttempts = currentCallAttempts;
      this.hasInitialSnapshot = true;
      this.activeTickets.set(tickets);
      this.waitingTickets.set(waiting);
      this.error.set('');
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    } finally {
      this.isRefreshing = false;
    }
  }

  private speak(text: string): void {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.onend = () => this.soundError.set('');
      utterance.onerror = () => {
        this.soundError.set('An audio announcement could not be played. Check the display’s sound.');
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      this.soundError.set('An audio announcement could not be played. Check the display’s sound.');
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
