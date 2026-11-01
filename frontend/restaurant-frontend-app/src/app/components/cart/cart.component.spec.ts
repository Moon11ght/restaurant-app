import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { Order } from '@app/models/orders/order.model';
import { Reservation } from '@app/models/reservations/reservation.model';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { ReservationService } from '@app/services/reservation/reservation.service';

import { CartComponent } from './cart.component';

describe('CartComponent', () => {
  let component: CartComponent;
  let fixture: ComponentFixture<CartComponent>;

  let preOrdersServiceMock: jasmine.SpyObj<PreOrdersService>;
  let reservationServiceMock: jasmine.SpyObj<ReservationService>;
  let routerMock: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    preOrdersServiceMock =
      jasmine.createSpyObj<PreOrdersService>(
        'PreOrdersService',
        [
          'getPreOrders',
          'cancelPreOrderByReservationId',
          'unsubmitPreOrderByReservationId',
          'submitPreOrderByReservationId',
          'editPreOrderByReservationId',
        ],
      );

    routerMock = jasmine.createSpyObj<Router>(
      'Router',
      ['navigate'],
    );

    preOrdersServiceMock.getPreOrders.and.returnValue(of([]));
    reservationServiceMock = jasmine.createSpyObj<ReservationService>(
      'ReservationService',
      ['getReservationsForUser$'],
    );
    reservationServiceMock.getReservationsForUser$.and.returnValue(
      of([
        {
          id: 'reservation-1',
          guestCount: 4,
        } as Reservation,
      ]),
    );

    await TestBed.configureTestingModule({
      imports: [CartComponent],
      providers: [
        {
          provide: PreOrdersService,
          useValue: preOrdersServiceMock,
        },
        {
          provide: ReservationService,
          useValue: reservationServiceMock,
        },
        {
          provide: Router,
          useValue: routerMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CartComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit closeCartEvent when closeCart is called', () => {
    spyOn(component.closeCartEvent, 'emit');

    component.closeCart();

    expect(
      component.closeCartEvent.emit,
    ).toHaveBeenCalled();
  });

  it('should return submitted orders with statuses 1 and 3', () => {
    component.orders.set([
      {
        orderId: 'order-1',
        status: 1,
      },
      {
        orderId: 'order-2',
        status: 2,
      },
      {
        orderId: 'order-3',
        status: 3,
      },
      {
        orderId: 'order-4',
        status: 0,
      },
    ] as Order[]);

    expect(
      component
        .submittedOrders()
        .map((order) => order.status),
    ).toEqual([1, 3]);
  });

  it('should return unsubmitted orders with status 0', () => {
    component.orders.set([
      {
        orderId: 'order-1',
        status: 0,
      },
      {
        orderId: 'order-2',
        status: 1,
      },
      {
        orderId: 'order-3',
        status: 3,
      },
    ] as Order[]);

    expect(
      component
        .unsubmittedOrders()
        .map((order) => order.status),
    ).toEqual([0]);
  });

  it('should navigate to reservations when goToReservations is called', () => {
    component.goToReservations();

    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/reservations',
    ]);
  });

  it('closes the cart and opens the menu with the selected reservation pre-order', () => {
    const order: Order = {
      orderId: 'order-1',
      reservationId: 'reservation-1',
      reservationAddress: 'Rustaveli Avenue',
      reservationTime: 'Oct 30, 2026, 3:15 PM - 4:45 PM',
      orderItems: [],
      status: 0,
    };
    component.orders.set([order]);
    spyOn(component.closeCartEvent, 'emit');

    component.addDishToOrder(order.orderId);

    expect(component.closeCartEvent.emit).toHaveBeenCalledOnceWith();
    expect(routerMock.navigate).toHaveBeenCalledOnceWith(
      ['/menu'],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({
          preOrder: 'true',
          reservationId: order.reservationId,
        }),
      }),
    );
  });

  it('shows a group pre-order action for reservations with multiple guests', () => {
    expect(component.hasGroupPreOrder('reservation-1')).toBeTrue();
    expect(component.hasGroupPreOrder('single-guest-reservation')).toBeFalse();
  });

  it('closes the cart and navigates to the reservation group pre-order', () => {
    spyOn(component.closeCartEvent, 'emit');

    component.openGroupPreOrder('reservation-1');

    expect(component.closeCartEvent.emit).toHaveBeenCalledOnceWith();
    expect(routerMock.navigate).toHaveBeenCalledOnceWith([
      '/reservations',
      'reservation-1',
      'group-order',
    ]);
  });
});
