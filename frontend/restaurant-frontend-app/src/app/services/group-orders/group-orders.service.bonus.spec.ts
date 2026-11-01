import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';
import { GroupOrdersService } from './group-orders.service';

describe('GroupOrdersService guest removal bonus', () => {
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

  it('deletes a guest session and emits the updated sessions response', () => {
    const updated: GroupSessionsResponse = { participants: [], total: 0 };
    let response: GroupSessionsResponse | undefined;
    service.removeSession$('group-1', 'guest-session-2').subscribe((value) => (response = value));

    const request = httpMock.expectOne(
      'https://test.api/guest/groups/group-1/sessions/guest-session-2',
    );
    expect(request.request.method).toBe('DELETE');
    request.flush(updated);
    expect(response).toEqual(updated);
  });
});
