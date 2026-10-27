import { inject, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { QueueApi, type StaffIdentity } from './queue-api';

@Injectable({ providedIn: 'root' })
export class StaffAuth {
  private readonly api = inject(QueueApi);
  private initialization: Promise<boolean> | undefined;
  readonly staff = signal<StaffIdentity | null>(null);
  readonly authError = signal('');

  initialize(): Promise<boolean> {
    if (!this.initialization) {
      this.initialization = this.api
        .getCurrentStaff()
        .then((staff) => {
          this.staff.set(staff);
          return true;
        })
        .catch((error: unknown) => {
          this.staff.set(null);
          if (error instanceof HttpErrorResponse && error.status === 401) {
            this.authError.set('');
          } else {
            this.authError.set(QueueApi.errorMessage(error));
          }
          return false;
        });
    }
    return this.initialization;
  }

  async login(username: string, password: string): Promise<void> {
    this.authError.set('');
    this.staff.set(await this.api.login(username, password));
    this.initialization = Promise.resolve(true);
  }

  async logout(): Promise<void> {
    await this.api.logout();
    this.staff.set(null);
    this.initialization = Promise.resolve(false);
  }

  clearLocalSession(): void {
    this.staff.set(null);
    this.initialization = Promise.resolve(false);
  }
}
