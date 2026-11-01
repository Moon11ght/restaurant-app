import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CardReservationComponent } from './card-reservation.component';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { ReservationCustomer, ReservationStatusCustomer } from '@app/models/reservations/reservation.model';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { of } from 'rxjs';

const RESERVATION: ReservationCustomer = {
  id: 'res-1',
  tableId: 'table-1',
  startTime: new Date('2026-10-21T16:00:00Z'),
  endTime: new Date('2026-10-21T17:30:00Z'),
  guestCount: 2,
  status: ReservationStatusCustomer.Reserved,
  restaurantName: 'Green & Tasty',
  locationAddress: 'Rustaveli Avenue 48',
  waiterId: 'waiter-1',
};

describe('CardReservationComponent', () => {
  let component: CardReservationComponent;
  let fixture: ComponentFixture<CardReservationComponent>;
  let guestInviteService: jasmine.SpyObj<GuestInviteService>;
  let toastService: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    guestInviteService = jasmine.createSpyObj<GuestInviteService>('GuestInviteService', [
      'getInviteToken$',
    ]);
    guestInviteService.getInviteToken$.and.returnValue(of({ token: 'invite-token' }));
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'https://test.api' },
        provideRouter([]),
        { provide: GuestInviteService, useValue: guestInviteService },
        { provide: ToastService, useValue: toastService },
      ],
      imports: [CardReservationComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CardReservationComponent);
    component = fixture.componentInstance;
    // r — обов'язковий input: без нього компонент падає з NG0950
    fixture.componentRef.setInput('r', RESERVATION);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a copy action for the guest session link and copies the generated link', async () => {
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy guest session link"]',
    );
    const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo();

    expect(guestInviteService.getInviteToken$).toHaveBeenCalledOnceWith(RESERVATION.id);
    expect(element.textContent).toContain('Guest session link');
    expect(button).not.toBeNull();
    expect(button!.disabled).toBeFalse();

    button!.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledOnceWith(
      `${window.location.origin}/join/invite-token`,
    );
    expect(toastService.success).toHaveBeenCalledWith(
      'Guest session link copied.',
      'Link copied!',
    );
  });
});
