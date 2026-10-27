import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Kiosk } from './kiosk';

describe('Kiosk', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Kiosk],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
  });

  it('should create the self-service check-in screen', () => {
    const fixture = TestBed.createComponent(Kiosk);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('issues a ticket for the visitor selected service', async () => {
    const fixture = TestBed.createComponent(Kiosk);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne('/api/catalog').flush({
      serviceTypes: [{ serviceTypeId: 3, name: 'General help' }],
      staff: [],
      servicePoints: [{ servicePointId: 4, name: 'Point A', serviceTypeIds: [3] }],
      ticketPrintingEnabled: true
    });
    http.expectOne('/api/queues/today').flush({
      queueId: 5,
      queueDate: '2026-10-14',
      status: 'OPEN'
    });

    await fixture.whenStable();
    fixture.detectChanges();
    const serviceButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    serviceButton.click();

    http.expectOne('/api/queues/today').flush({
      queueId: 5,
      queueDate: '2026-10-14',
      status: 'OPEN'
    });
    await fixture.whenStable();

    http.expectOne('/api/queues/5/tickets').flush({
      ticketId: 8,
      sequenceNumber: 12,
      serviceTypeName: 'General help',
      status: 'WAITING'
    });

    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('012');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Print or reprint ticket');
    const print = spyOn(window, 'print');
    const printButton = fixture.nativeElement.querySelector(
      '.ticket-card .kiosk-button.primary'
    ) as HTMLButtonElement;
    printButton.click();
    await fixture.whenStable();
    printButton.click();
    await fixture.whenStable();
    expect(print).toHaveBeenCalledTimes(2);
    expect(http.match('/api/queues/5/tickets').length).toBe(0);
    http.verify();
  });

  it('keeps the ticket on screen without showing print controls when printing is disabled', async () => {
    const fixture = TestBed.createComponent(Kiosk);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/catalog').flush({
      serviceTypes: [{ serviceTypeId: 3, name: 'General help' }],
      staff: [],
      servicePoints: [{ servicePointId: 4, name: 'Point A', serviceTypeIds: [3] }],
      ticketPrintingEnabled: false
    });
    http.expectOne('/api/queues/today').flush({
      queueId: 5,
      queueDate: '2026-10-14',
      status: 'OPEN'
    });
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button')!.click();
    http.expectOne('/api/queues/today').flush({
      queueId: 5,
      queueDate: '2026-10-14',
      status: 'OPEN'
    });
    await fixture.whenStable();
    http.expectOne('/api/queues/5/tickets').flush({
      ticketId: 8,
      sequenceNumber: 12,
      serviceTypeName: 'General help',
      status: 'WAITING'
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('012');
    expect(page.querySelector('.ticket-card .kiosk-button.primary')).toBeNull();
    http.verify();
  });
});
