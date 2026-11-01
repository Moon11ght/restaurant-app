import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { GroupOrdersService } from './group-orders.service';

describe('GroupOrdersService', () => {
  let service: GroupOrdersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'https://test.api' },
      ],
    });
    service = TestBed.inject(GroupOrdersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads sessions and marks silent refreshes to skip global error toasts', () => {
    service.getSessions$('group/1', { silent: true }).subscribe();

    const request = httpMock.expectOne('https://test.api/guest/groups/group%2F1/sessions');
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    request.flush({ participants: [], total: 0 });
  });

  it('loads status and owner session id from their API endpoints', () => {
    service.getStatus$('group-1', { silent: true }).subscribe();
    const status = httpMock.expectOne('https://test.api/guest/groups/group-1/status');
    expect(status.request.context.get(SKIP_ERROR_TOAST)).toBeTrue();
    status.flush({ currentParticipants: 1, maxCapacity: 4, status: 'Open' });

    service.getOwnerSessionId$('reservation-1').subscribe();
    const owner = httpMock.expectOne('https://test.api/reservations/reservation-1/guest-session-id');
    expect(owner.request.context.get(SKIP_ERROR_TOAST)).toBeFalse();
    owner.flush({ guestSessionId: 'owner-session' });
  });

  it('submits a consolidated group pre-order for its parent reservation', () => {
    service.submitGroupPreOrder$('group-1', 'reservation-1').subscribe();

    const request = httpMock.expectOne('https://test.api/group-reservations/group-1/submit');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reservationId: 'reservation-1' });
    request.flush([{ dishId: 'dish-1', quantity: 2 }]);
  });

});
