import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { QueueApi, type QueueTicket, type ServicePointOption } from './queue-api';
import { ServiceDesk } from './service-desk';
import { StaffAuth } from './staff-auth';

describe('ServiceDesk station workflow', () => {
  let api: jasmine.SpyObj<QueueApi>;
  let auth: StaffAuth;
  const stationOne: ServicePointOption = {
    servicePointId: 1,
    name: 'Reception',
    serviceTypeIds: [11]
  };
  const stationTwo: ServicePointOption = {
    servicePointId: 2,
    name: 'Accounts',
    serviceTypeIds: [22]
  };

  beforeEach(async () => {
    spyOn(window, 'setInterval').and.returnValue(1);
    spyOn(window, 'clearInterval');
    api = jasmine.createSpyObj<QueueApi>('QueueApi', [
      'getCatalog',
      'getAssignedServicePoints',
      'getMyCurrentStation',
      'setMyCurrentStation',
      'getMyStats',
      'openToday',
      'getWaiting',
      'getActive',
      'getNoShows',
      'getStaffActivity',
      'callNext'
    ]);
    api.getCatalog.and.resolveTo({
      serviceTypes: [
        { serviceTypeId: 11, name: 'General help' },
        { serviceTypeId: 22, name: 'Payments' }
      ],
      staff: [],
      servicePoints: [stationOne, stationTwo],
      ticketPrintingEnabled: false
    });
    api.getMyCurrentStation.and.resolveTo({ servicePointId: null });
    api.setMyCurrentStation.and.resolveTo();
    api.getMyStats.and.resolveTo({
      totalLoginSeconds: 0,
      ticketsCompleted: 0,
      noShows: 0,
      ticketsReturned: 0,
      byServicePoint: []
    });
    api.openToday.and.resolveTo({
      queueId: 5,
      queueDate: '2026-10-16',
      status: 'OPEN'
    });
    api.getWaiting.and.resolveTo([]);
    api.getActive.and.resolveTo([]);
    api.getNoShows.and.resolveTo([]);
    api.getStaffActivity.and.resolveTo([]);
    api.callNext.and.resolveTo(null);

    await TestBed.configureTestingModule({
      imports: [ServiceDesk],
      providers: [provideRouter([]), { provide: QueueApi, useValue: api }]
    }).compileComponents();
    auth = TestBed.inject(StaffAuth);
    auth.staff.set({
      staffId: 7,
      username: 'operator',
      displayName: 'Operator',
      role: 'STAFF'
    });
  });

  async function render(assignedStations: ServicePointOption[], waiting: QueueTicket[] = []) {
    api.getAssignedServicePoints.and.resolveTo(assignedStations);
    api.getWaiting.and.resolveTo(waiting);
    const fixture = TestBed.createComponent(ServiceDesk);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('automatically selects and reports a staff member’s sole assigned station', async () => {
    const fixture = await render([stationOne], [
      {
        ticketId: 100,
        sequenceNumber: 1,
        serviceTypeId: 11,
        serviceTypeName: 'General help'
      }
    ]);

    const page = fixture.nativeElement as HTMLElement;
    const stationSelector = page.querySelector<HTMLSelectElement>('#service-point');
    const callButton = page.querySelector<HTMLButtonElement>('.call-card .button-dark');
    expect(stationSelector?.selectedOptions[0]?.textContent).toContain('Reception');
    expect(page.textContent).toContain('Currently working at Reception');
    expect(api.setMyCurrentStation).toHaveBeenCalledWith(1);
    expect(callButton?.disabled).toBeFalse();
    fixture.destroy();
  });

  it('requires a station choice when several are assigned and explains ineligible queues', async () => {
    const fixture = await render([stationOne, stationTwo], [
      {
        ticketId: 200,
        sequenceNumber: 1,
        serviceTypeId: 11,
        serviceTypeName: 'General help'
      }
    ]);

    const page = fixture.nativeElement as HTMLElement;
    const stationSelector = page.querySelector<HTMLSelectElement>('#service-point')!;
    const callButton = page.querySelector<HTMLButtonElement>('.call-card .button-dark')!;
    expect(stationSelector.selectedOptions[0]?.textContent).toContain('Choose your current station');
    expect(page.textContent).toContain('Select the station you are physically working at');
    expect(callButton.disabled).toBeTrue();

    stationSelector.value = [...stationSelector.options].find((option) =>
      option.textContent?.includes('Accounts')
    )!.value;
    stationSelector.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(page.textContent).toContain('Currently working at Accounts');
    expect(page.textContent).toContain('No waiting customer currently needs a service');
    expect(callButton.disabled).toBeTrue();

    stationSelector.value = [...stationSelector.options].find((option) =>
      option.textContent?.includes('Reception')
    )!.value;
    stationSelector.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(page.textContent).toContain('Currently working at Reception');
    expect(callButton.disabled).toBeFalse();
    fixture.destroy();
  });
});
