import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { Kiosk } from './kiosk';
import { WaitingRoomDisplay } from './waiting-room-display';
import { AdminPanel } from './admin-panel';
import { StaffAuth } from './staff-auth';
import { StaffLogin } from './staff-login';
import { ServiceDesk } from './service-desk';

const staffGuard: CanActivateFn = async () => {
  const auth = inject(StaffAuth);
  const router = inject(Router);
  return (await auth.initialize()) || router.createUrlTree(['/staff-login']);
};

const adminGuard: CanActivateFn = async () => {
  const auth = inject(StaffAuth);
  const router = inject(Router);
  const signedIn = await auth.initialize();
  if (!signedIn) {
    return router.createUrlTree(['/staff-login']);
  }
  return auth.staff()?.role === 'ADMIN' ? true : router.createUrlTree(['/']);
};

export const routes: Routes = [
  { path: '', component: ServiceDesk, canActivate: [staffGuard] },
  { path: 'admin', component: AdminPanel, canActivate: [adminGuard] },
  { path: 'staff-login', component: StaffLogin },
  { path: 'kiosk', component: Kiosk },
  { path: 'display', component: WaitingRoomDisplay },
  { path: '**', redirectTo: '' }
];
