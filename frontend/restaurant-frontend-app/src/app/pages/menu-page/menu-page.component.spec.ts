import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MenuPageComponent } from './menu-page.component';
import { DishesService } from '@app/services/dishes/dishes.service';
import { PreOrdersService } from '@app/services/pre-orders/pre-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { DishListResponse } from '@app/models/dishes/dish-list-response.model';

describe('MenuPageComponent', () => {
  let component: MenuPageComponent;
  let fixture: ComponentFixture<MenuPageComponent>;
  let dishesServiceMock: jasmine.SpyObj<DishesService>;
  let preOrdersServiceMock: jasmine.SpyObj<PreOrdersService>;
  let toastServiceMock: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    dishesServiceMock = jasmine.createSpyObj<DishesService>('DishesService', ['getDishes']);
    dishesServiceMock.getDishes.and.returnValue(of([]));
    preOrdersServiceMock = jasmine.createSpyObj<PreOrdersService>(
      'PreOrdersService',
      ['addDishToPreOrderByReservationId'],
    );
    preOrdersServiceMock.addDishToPreOrderByReservationId.and.returnValue(of({ success: true }));
    toastServiceMock = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PreOrdersService, useValue: preOrdersServiceMock },
        { provide: ToastService, useValue: toastServiceMock },
      ],
      imports: [MenuPageComponent],
    });

    TestBed.overrideComponent(MenuPageComponent, {
      set: { providers: [{ provide: DishesService, useValue: dishesServiceMock }] },
    });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(MenuPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('adds a selected dish to the reservation pre-order', () => {
    const dish: DishListResponse = {
      id: 'dish-1',
      name: 'Spring Salad',
      imageUrl: 'salad.jpg',
      price: 12,
      state: 'Available',
      weight: '430 g',
      dishType: 'Appetizer',
      description: 'Fresh salad',
      calories: '420',
      proteins: '10 g',
      carbohydrates: '50 g',
      fats: '8 g',
      vitamins: 'A, C',
    };
    component.preOrderReservationId = 'reservation-1';

    component.addDishToCart(dish);

    expect(preOrdersServiceMock.addDishToPreOrderByReservationId).toHaveBeenCalledOnceWith(
      'reservation-1',
      dish,
      1,
    );
    expect(toastServiceMock.success).toHaveBeenCalled();
  });
});
