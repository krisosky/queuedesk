import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { QueueApi } from './queue-api';
import { StaffAuth } from './staff-auth';

describe('StaffAuth', () => {
  let api: jasmine.SpyObj<QueueApi>;
  let auth: StaffAuth;

  beforeEach(() => {
    api = jasmine.createSpyObj<QueueApi>('QueueApi', [
      'getCurrentStaff',
      'login',
      'logout'
    ]);
    TestBed.configureTestingModule({
      providers: [StaffAuth, { provide: QueueApi, useValue: api }]
    });
    auth = TestBed.inject(StaffAuth);
  });

  it('recognizes an existing session', async () => {
    const staff = { staffId: 4, username: 'alex', displayName: 'Alex', role: 'STAFF' as const };
    api.getCurrentStaff.and.resolveTo(staff);

    expect(await auth.initialize()).toBeTrue();
    expect(auth.staff()).toEqual(staff);
  });

  it('treats an expired or missing session as signed out', async () => {
    api.getCurrentStaff.and.rejectWith(
      new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })
    );

    expect(await auth.initialize()).toBeFalse();
    expect(auth.staff()).toBeNull();
  });

  it('stores the signed-in staff identity and clears it on logout', async () => {
    const staff = { staffId: 4, username: 'alex', displayName: 'Alex', role: 'STAFF' as const };
    api.login.and.resolveTo(staff);
    api.logout.and.resolveTo();

    await auth.login('alex', 'a-very-long-test-password');
    expect(auth.staff()).toEqual(staff);
    await auth.logout();
    expect(auth.staff()).toBeNull();
  });
});
