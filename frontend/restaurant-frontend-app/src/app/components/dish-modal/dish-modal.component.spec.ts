import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DishListResponse } from '@app/models/dishes/dish-list-response.model';

import { DishModalComponent } from './dish-modal.component';

describe('DishModalComponent', () => {
  let component: DishModalComponent;
  let fixture: ComponentFixture<DishModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DishModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DishModalComponent);
    component = fixture.componentInstance;
    component.dish = {
      id: 'dish-1',
      name: 'Sample dish',
      imageUrl: '',
      price: 12,
      state: '',
      weight: '250 g',
      dishType: 'Main Course',
      description: '',
      calories: '0',
      proteins: '0',
      carbohydrates: '0',
      fats: '0',
      vitamins: '',
    } satisfies DishListResponse;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
