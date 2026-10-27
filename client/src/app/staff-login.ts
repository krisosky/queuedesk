import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { QueueApi } from './queue-api';
import { StaffAuth } from './staff-auth';

@Component({
  selector: 'app-staff-login',
  imports: [CommonModule, FormsModule],
  template: `
    <main class="login-page">
      <section class="login-card">
        <a class="brand" href="/" aria-label="QueueDesk home">
          <span class="brand-mark" aria-hidden="true">Q</span>
          <span>Queue<span class="brand-light">Desk</span></span>
        </a>
        <p class="eyebrow">STAFF ACCESS</p>
        <h1>Sign in to the service desk</h1>
        <p class="intro">Use your individual staff account to manage the queue.</p>
        @if (auth.authError() || error()) {
          <p class="login-error" role="alert">{{ error() || auth.authError() }}</p>
        }
        <form (ngSubmit)="signIn()">
          <label for="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            autocomplete="username"
            [(ngModel)]="username"
            required
          />
          <label for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            [(ngModel)]="password"
            required
          />
          <button type="submit" [disabled]="working() || !username || !password">
            {{ working() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
        <p class="privacy-note">Visitors do not need an account or personal details.</p>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
    .login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f3f7f3; }
    .login-card { width: min(100%, 440px); padding: 40px; border: 1px solid #e1e9e2; border-radius: 20px; background: #fff; box-shadow: 0 20px 60px rgba(28, 54, 37, .08); }
    .brand { display: inline-flex; align-items: center; gap: 11px; margin-bottom: 38px; color: #202b24; font-size: 19px; font-weight: 750; text-decoration: none; }
    .brand-mark { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 11px; color: #fff; background: #337951; }
    .brand-light { color: #7b8780; font-weight: 500; }
    .eyebrow { margin: 0 0 8px; color: #337951; font-size: 10px; font-weight: 800; letter-spacing: 1.5px; }
    h1 { margin: 0; color: #202b24; font-size: 30px; line-height: 1.2; }
    .intro, .privacy-note { color: #6f7d73; line-height: 1.5; }
    form { display: grid; gap: 10px; margin-top: 26px; }
    label { margin-top: 8px; color: #334238; font-size: 13px; font-weight: 700; }
    input { min-height: 46px; padding: 0 12px; border: 1px solid #d5dfd7; border-radius: 8px; color: #202b24; font: inherit; }
    input:focus { border-color: #337951; outline: 3px solid rgba(51, 121, 81, .16); }
    button { min-height: 48px; margin-top: 12px; border: 0; border-radius: 8px; color: #fff; background: #337951; font: inherit; font-weight: 750; cursor: pointer; }
    button:disabled { opacity: .55; cursor: wait; }
    .login-error { padding: 11px 13px; border-radius: 8px; color: #8b2525; background: #fff0ed; }
    .privacy-note { margin: 20px 0 0; font-size: 12px; text-align: center; }
    @media (max-width: 480px) { .login-card { padding: 28px 22px; } }
  `]
})
export class StaffLogin {
  protected readonly auth = inject(StaffAuth);
  private readonly router = inject(Router);
  protected username = '';
  protected password = '';
  protected readonly error = signal('');
  protected readonly working = signal(false);

  protected async signIn(): Promise<void> {
    if (this.working()) {
      return;
    }
    this.working.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.username, this.password);
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(QueueApi.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }
}
