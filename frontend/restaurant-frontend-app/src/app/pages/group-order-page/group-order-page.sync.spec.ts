import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { DEMO_INVITE, GroupOrdersMockStore } from '@app/shared/mocks/group-orders/group-orders.mock-store';
import { GroupOrderPageComponent } from './group-order-page.component';

const SESSIONS: GroupSessionsResponse = new GroupOrdersMockStore().snapshot();
const OPEN_STATUS: GroupStatusResponse = {
  currentParticipants: 4,
  maxCapacity: 4,
  status: 'Open',
};

describe('GroupOrderPageComponent background sync', () => {
  let fixture: ComponentFixture<GroupOrderPageComponent> | undefined;
  let groupOrders: jasmine.SpyObj<GroupOrdersService>;
  let guestInvites: jasmine.SpyObj<GuestInviteService>;
  let toastService: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    groupOrders = jasmine.createSpyObj<GroupOrdersService>('GroupOrdersService', [
      'getSessions$',
      'getStatus$',
      'submitGroupPreOrder$',
      'removeSession$',
    ]);
    guestInvites = jasmine.createSpyObj<GuestInviteService>('GuestInviteService', [
      'getInviteToken$',
      'getInvite$',
    ]);
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    guestInvites.getInviteToken$.and.returnValue(of({ token: 'invite-token' }));
    guestInvites.getInvite$.and.returnValue(of(DEMO_INVITE));
    groupOrders.getSessions$.and.returnValue(of(SESSIONS));
    groupOrders.getStatus$.and.returnValue(of(OPEN_STATUS));
    groupOrders.submitGroupPreOrder$.and.returnValue(of([]));
    groupOrders.removeSession$.and.returnValue(of(SESSIONS));

    TestBed.configureTestingModule({
      imports: [GroupOrderPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ reservationId: 'reservation-1' })),
            snapshot: { paramMap: convertToParamMap({ reservationId: 'reservation-1' }) },
          },
        },
        { provide: GroupOrdersService, useValue: groupOrders },
        { provide: GuestInviteService, useValue: guestInvites },
        { provide: ToastService, useValue: toastService },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
  });

  function createFixture(): ComponentFixture<GroupOrderPageComponent> {
    fixture = TestBed.createComponent(GroupOrderPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('identifies and puts the owner first from the participants response', () => {
    const view = createFixture();

    expect(view.componentInstance.participants()[0]?.type).toBe('Owner');
  });

  it('refreshes open groups every 15 seconds using silent API requests', fakeAsync(() => {
    createFixture();
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(1);

    tick(14_999);
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(1);
    tick(1);

    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(2);
    expect(groupOrders.getSessions$).toHaveBeenCalledWith(DEMO_INVITE.GroupReservationId, { silent: true });
    expect(groupOrders.getStatus$).toHaveBeenCalledWith(DEMO_INVITE.GroupReservationId, { silent: true });
  }));

  it('lets Refresh request and display the latest snapshot without a page loader', fakeAsync(() => {
    const updatedSessions: GroupSessionsResponse = {
      participants: [
        {
          ...SESSIONS.participants[0],
          items: [{ dish: { id: 'dish-one', name: 'One dish', price: 12 }, quantity: 1 }],
        },
      ],
      total: 12,
    };
    groupOrders.getSessions$.and.returnValues(of(SESSIONS), of(updatedSessions));

    const view = createFixture();
    const refreshButton = view.nativeElement.querySelector('.refresh-button') as HTMLButtonElement;
    refreshButton.click();
    view.detectChanges();

    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(2);
    expect(view.nativeElement.textContent).toContain('Updated at');
    expect(view.nativeElement.textContent).toContain('$12.00');
    expect(view.nativeElement.textContent).not.toContain('Loading group pre-order');
  }));

  it('shows a closed state without presenting it as submitted or open', fakeAsync(() => {
    groupOrders.getStatus$.and.returnValue(of({ ...OPEN_STATUS, status: 'Closed' }));

    const view = createFixture();

    expect(view.nativeElement.querySelector('.status-badge')?.textContent).toContain('Pre-orders closed');
    expect(view.nativeElement.querySelector('.submit-button')).toBeNull();
    expect(view.nativeElement.textContent).toContain('This group pre-order is closed');
  }));

  it('keeps the last data and reports its update time after a silent refresh error', fakeAsync(() => {
    groupOrders.getSessions$.and.returnValues(
      of(SESSIONS),
      throwError(() => new Error('network unavailable')),
    );

    const view = createFixture();
    tick(15_000);
    view.detectChanges();

    expect(view.nativeElement.textContent).toContain("Couldn't refresh. Showing data from");
    expect(view.nativeElement.textContent).toContain('$50.50');
  }));

  it('starts a single polling timer after Try again succeeds', fakeAsync(() => {
    groupOrders.getSessions$.and.returnValues(
      throwError(() => new Error('initial failure')),
      of(SESSIONS),
      of(SESSIONS),
    );

    const view = createFixture();
    expect(view.nativeElement.textContent).toContain("Couldn't load this group pre-order.");
    (view.nativeElement.querySelector('button') as HTMLButtonElement).click();
    view.detectChanges();

    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(2);
    tick(15_000);
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(3);
  }));

  it('does not start another refresh while a previous refresh is pending', fakeAsync(() => {
    const pendingSessions = new Subject<GroupSessionsResponse>();
    groupOrders.getSessions$.and.returnValues(of(SESSIONS), pendingSessions);

    createFixture();
    tick(15_000);
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(2);

    tick(30_000);
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(2);

    pendingSessions.next(SESSIONS);
    pendingSessions.complete();
    tick(15_000);
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(3);
  }));

  it('stops polling when the group is submitted and when the page is destroyed', fakeAsync(() => {
    const view = createFixture();
    (view.nativeElement.querySelector('.submit-button') as HTMLButtonElement).click();
    view.detectChanges();
    expect(groupOrders.submitGroupPreOrder$).not.toHaveBeenCalled();
    expect(view.nativeElement.querySelector('[role="dialog"]')?.textContent).toContain('Submit');
    (view.nativeElement.querySelector('.submit-confirm-button') as HTMLButtonElement).click();
    view.detectChanges();
    expect(groupOrders.submitGroupPreOrder$).toHaveBeenCalledWith(
      DEMO_INVITE.GroupReservationId,
      'reservation-1',
    );
    expect(toastService.success).toHaveBeenCalledOnceWith('Pre-order sent to the restaurant');

    tick(15_000);
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(1);

    // A separate open instance verifies the destroy hook clears its interval too.
    groupOrders.getStatus$.and.returnValue(of(OPEN_STATUS));
    const secondView = TestBed.createComponent(GroupOrderPageComponent);
    secondView.detectChanges();
    const callsBeforeDestroy = groupOrders.getSessions$.calls.count();
    secondView.destroy();
    tick(15_000);
    expect(groupOrders.getSessions$).toHaveBeenCalledTimes(callsBeforeDestroy);
  }));
});
