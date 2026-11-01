// Рівень 1 · верстка сторінки на статичних даних (GROUP_ORDER_PREVIEW).
// Запуск: npm run test:hw
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ToastService } from '@app/services/toast/toast.service';
import { GroupOrderPageComponent } from './group-order-page.component';

describe('Рівень 1 · верстка сторінки', () => {
  let element: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']),
        },
      ],
    });
    const fixture = TestBed.createComponent(GroupOrderPageComponent);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  });

  it('один <main> і один <h1> «Group Pre-Order»', () => {
    expect(element.querySelectorAll('main').length).toBe(1);
    expect(element.querySelectorAll('h1').length).toBe(1);
    expect(element.querySelector('h1')?.textContent).toContain('Group Pre-Order');
  });

  it('шапка: адреса, дата і «4 of 4 guests»', () => {
    const text = element.textContent ?? '';
    expect(text).toContain('Rustaveli Avenue 48');
    expect(text).toContain('Oct 21, 2026');
    expect(text).toContain('4 of 4 guests');
  });

  it('учасники — список <ul>/<li> з картками', () => {
    expect(element.querySelectorAll('li app-participant-card').length).toBe(4);
  });

  it('статус кошика видно текстом', () => {
    expect(element.textContent).toContain('Submitted');
    expect(element.textContent).toContain('Still choosing');
  });

  it('Grand Total — лише підтверджені кошики, $50.50', () => {
    expect(element.textContent).toContain('Grand Total');
    expect(element.textContent).toContain('$50.50');
  });

  it('shows the owner label, consolidated order, waiting guests and open status', () => {
    const text = element.textContent ?? '';
    expect(text).toContain('My Pre-Order');
    expect(text).toContain('Consolidated pre-order');
    expect(text).toContain("2 participants haven't submitted their cart yet");
    expect(text).toContain('Collecting pre-orders');
  });
});
