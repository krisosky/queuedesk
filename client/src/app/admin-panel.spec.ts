import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { QueueApi, type AdminConfiguration } from './queue-api';
import { AdminPanel } from './admin-panel';

describe('AdminPanel', () => {
  let api: jasmine.SpyObj<QueueApi>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<QueueApi>('QueueApi', [
      'getAdminConfiguration',
      'getAdminStaffStats',
      'openToday',
      'getStaffActivity',
      'createAdminService',
      'updateAdminStaffAccount',
      'setTicketPrintingEnabled'
    ]);
    const config: AdminConfiguration = {
      services: [
        {
          serviceTypeId: 1,
          name: 'Help desk',
          description: null,
          isActive: true
        }
      ],
      servicePoints: [
        {
          servicePointId: 1,
          name: 'Reception',
          isActive: true,
          serviceTypeIds: [1]
        }
      ],
      staff: [
        {
          staffId: 1,
          displayName: 'Alex',
          username: 'alex',
          role: 'ADMIN',
          isActive: true,
          hasAccount: true,
          servicePointIds: [1],
          currentServiceStations: ['Reception'],
          stats: {
            totalLoginSeconds: 3661,
            ticketsCompleted: 5,
            noShows: 1,
            ticketsReturned: 2,
            byServicePoint: [
              {
                servicePointId: 1,
                servicePointName: 'Reception',
                ticketsCompleted: 5,
                noShows: 1,
                ticketsReturned: 2
              }
            ]
          }
        }
      ],
      ticketPrintingEnabled: false
    };
    api.getAdminConfiguration.and.callFake(async () => ({
      ...config,
      staff: config.staff.map((staff) => ({ ...staff }))
    }));
    api.getAdminStaffStats.and.resolveTo([]);
    api.openToday.and.resolveTo({ queueId: 1, queueDate: '2026-10-15', status: 'OPEN' });
    api.getStaffActivity.and.resolveTo([]);
    api.createAdminService.and.resolveTo();
    api.updateAdminStaffAccount.and.callFake(async (staff) => {
      config.staff = config.staff.map((existing) =>
        existing.staffId === staff.staffId ? { ...staff } : existing
      );
    });
    api.setTicketPrintingEnabled.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [AdminPanel],
      providers: [provideRouter([]), { provide: QueueApi, useValue: api }]
    }).compileComponents();
  });

  it('loads services, service points, staff access, and activity sections', async () => {
    const fixture = TestBed.createComponent(AdminPanel);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('Services');
    expect(page.textContent).toContain('Service stations');
    expect(page.textContent).toContain('Staff accounts');
    expect(page.textContent).toContain('Help desk');
    expect(page.querySelector('fieldset legend')?.textContent).toContain('Services handled');
    expect(page.querySelector<HTMLInputElement>('#staff-username-1')?.value)
      .toBe('alex');
    expect(page.textContent).toContain('1h 1m');
    expect(page.querySelector('.staff-stats-table')).not.toBeNull();
    expect(page.textContent).toContain('Staff performance');
    expect(page.textContent).toContain('Completed');
    expect(page.textContent).toContain('No-shows');
    expect(page.textContent).toContain('Returns');
    expect(page.textContent).toContain('5');
    expect(page.textContent).toContain('Currently working at');
    expect(page.textContent).toContain('Station history');
    expect(page.textContent).toContain('Reception');
  });

  it('preserves unsaved service-point selections after creating a service', async () => {
    const fixture = TestBed.createComponent(AdminPanel);
    fixture.detectChanges();
    await fixture.whenStable();
    Object.assign(fixture.componentInstance, {
      serviceName: 'Appointments',
      pointServiceDrafts: signal({ 1: [] })
    });
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const routingCheckbox = page.querySelector<HTMLInputElement>(
      '.point-card fieldset input[type="checkbox"]'
    );
    const serviceForm = page.querySelector<HTMLFormElement>('.service-create');
    expect(routingCheckbox).not.toBeNull();
    expect(serviceForm).not.toBeNull();

    serviceForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.createAdminService).toHaveBeenCalledWith('Appointments', null);
    expect(
      page.querySelector<HTMLInputElement>('.point-card fieldset input[type="checkbox"]')?.checked
    ).toBeFalse();
  });

  it('refreshes the current station and per-station staff totals', async () => {
    const fixture = TestBed.createComponent(AdminPanel);
    fixture.detectChanges();
    await fixture.whenStable();
    api.getAdminStaffStats.and.resolveTo([
      {
        staffId: 1,
        currentServiceStations: ['Window 2'],
        stats: {
          totalLoginSeconds: 7200,
          ticketsCompleted: 8,
          noShows: 2,
          ticketsReturned: 1,
          byServicePoint: [
            {
              servicePointId: 1,
              servicePointName: 'Window 2',
              ticketsCompleted: 8,
              noShows: 2,
              ticketsReturned: 1
            }
          ]
        }
      }
    ]);
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    page.querySelector<HTMLButtonElement>('.staff-stats-actions button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.getAdminStaffStats).toHaveBeenCalled();
    expect(page.textContent).toContain('Window 2');
    expect(page.textContent).toContain('2h 0m');
    expect(page.textContent).toContain('8 completed');
  });

  it('allows username edits and archives staff without deleting history', async () => {
    const fixture = TestBed.createComponent(AdminPanel);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const username = page.querySelector<HTMLInputElement>('#staff-username-1');
    expect(username).not.toBeNull();
    username!.value = 'alex.updated';
    username!.dispatchEvent(new Event('input', { bubbles: true }));
    username!.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    page.querySelector<HTMLButtonElement>('.staff-deactivate-button')!.click();
    fixture.detectChanges();
    expect(api.updateAdminStaffAccount).not.toHaveBeenCalled();
    expect(page.querySelector('[role="alertdialog"]')?.textContent).toContain('Deactivate Alex?');
    expect(page.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'history will be retained'
    );

    page.querySelector<HTMLButtonElement>('.deactivation-dialog-actions .secondary-button')!.click();
    fixture.detectChanges();
    expect(api.updateAdminStaffAccount).not.toHaveBeenCalled();

    page.querySelector<HTMLButtonElement>('.staff-deactivate-button')!.click();
    fixture.detectChanges();
    page.querySelector<HTMLButtonElement>('.deactivation-confirm-button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.updateAdminStaffAccount).toHaveBeenCalledWith(
      jasmine.objectContaining({
        staffId: 1,
        username: 'alex.updated',
        isActive: false
      })
    );
    expect(page.querySelector('.inactive-staff-disclosure')?.textContent).toContain('Alex');
    expect(page.querySelector('.inactive-staff-disclosure')?.textContent).toContain(
      'Sign-in disabled'
    );
    expect(page.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('uses accessible disclosure controls for configuration sections', async () => {
    const fixture = TestBed.createComponent(AdminPanel);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    const disclosures = [...page.querySelectorAll<HTMLDetailsElement>('details.admin-card')];
    expect(disclosures.length).toBe(5);
    expect(disclosures[0].open).toBeTrue();
    expect(disclosures.slice(1).every((section) => !section.open)).toBeTrue();
    expect(page.querySelectorAll('details.admin-card > summary').length).toBe(5);
  });
});
