import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { QueueApi } from './queue-api';
import { WaitingRoomDisplay } from './waiting-room-display';

describe('WaitingRoomDisplay', () => {
  let api: jasmine.SpyObj<QueueApi>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<QueueApi>('QueueApi', ['openToday', 'getActive', 'getWaiting']);
    api.openToday.and.resolveTo({ queueId: 1, queueDate: '2026-10-14', status: 'OPEN' });
    api.getActive.and.resolveTo([]);
    api.getWaiting.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [WaitingRoomDisplay],
      providers: [{ provide: QueueApi, useValue: api }]
    }).compileComponents();
  });

  it('shows called, in-service, and next waiting numbers with clear labels', async () => {
    api.getActive.and.resolveTo([
      {
        ticketId: 4,
        sequenceNumber: 14,
        serviceTypeName: 'Help desk',
        status: 'CALLED',
        servicePointId: 2,
        servicePointName: 'Service point 2'
      },
      {
        ticketId: 5,
        sequenceNumber: 13,
        serviceTypeName: 'Repairs',
        status: 'IN_SERVICE',
        servicePointId: 1,
        servicePointName: 'Service point 1'
      }
    ]);
    api.getWaiting.and.resolveTo([
      { ticketId: 6, sequenceNumber: 15, serviceTypeName: 'Help desk' },
      { ticketId: 7, sequenceNumber: 16, serviceTypeName: 'Repairs' }
    ]);
    const fixture = TestBed.createComponent(WaitingRoomDisplay);

    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('014');
    expect(page.textContent).toContain('013');
    expect(page.textContent).toContain('015');
    expect(page.textContent).toContain('Service point 2');
    expect(page.textContent).toContain('NOW CALLED');
    expect(page.textContent).toContain('CURRENTLY BEING ATTENDED TO');
    expect(page.textContent).toContain('PLEASE BE READY');
    expect(page.textContent).not.toContain('Help desk');
    fixture.destroy();
  });

  it('shows an idle message when the queue has no active or waiting tickets', async () => {
    const fixture = TestBed.createComponent(WaitingRoomDisplay);

    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No customers are being called right now'
    );
    fixture.destroy();
  });

  it('speaks new calls and repeated calls only after sound is enabled', fakeAsync(() => {
    const speak = spyOn(window.speechSynthesis, 'speak');
    const fixture = TestBed.createComponent(WaitingRoomDisplay);
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();

    const enableSound = (fixture.nativeElement as HTMLElement).querySelector(
      '.sound-toggle'
    ) as HTMLButtonElement;
    enableSound.click();
    expect(speak).toHaveBeenCalledTimes(1);
    speak.calls.reset();

    const calledTicket = {
      ticketId: 9,
      sequenceNumber: 26,
      serviceTypeName: 'Help desk',
      status: 'CALLED' as const,
      attemptNumber: 1,
      servicePointId: 2,
      servicePointName: 'Service point 2'
    };
    api.getActive.and.resolveTo([calledTicket]);
    tick(4000);
    flushMicrotasks();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.calls.mostRecent().args[0].text).toContain(
      'Ticket 0 2 6. Please proceed to Service point 2.'
    );

    api.getActive.and.resolveTo([{ ...calledTicket, attemptNumber: 2 }]);
    tick(4000);
    flushMicrotasks();
    expect(speak).toHaveBeenCalledTimes(2);
    fixture.destroy();
  }));
});
