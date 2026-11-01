import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Reservation, ReservationStatus } from '@app/models/reservations/reservation.model';

import { ReservationConfirmedComponent } from './reservation-confirmed.component';

describe('ReservationConfirmedComponent', () => {
  let component: ReservationConfirmedComponent;
  let fixture: ComponentFixture<ReservationConfirmedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReservationConfirmedComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReservationConfirmedComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('reservation', {
      id: 'reservation-1',
      tableId: 'table-1',
      customerId: 'customer-1',
      startTime: new Date('2026-10-30T12:00:00Z'),
      endTime: new Date('2026-10-30T13:00:00Z'),
      guestCount: 2,
      status: ReservationStatus.Reserved,
      locationAddress: '48 Rustaveli Avenue',
      tableCapacity: 4,
      waiterId: '',
      restaurantName: 'Green & Tasty',
    } satisfies Reservation);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
