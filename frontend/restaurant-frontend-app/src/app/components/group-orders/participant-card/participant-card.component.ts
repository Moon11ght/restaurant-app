import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { DishShort, Participant } from '../../../models/group-orders/participant.model';
import { DishListResponse } from '../../../models/dishes/dish-list-response.model';
import { DishModalComponent } from '../../dish-modal/dish-modal.component';

@Component({
  selector: 'app-participant-card',
  standalone: true,
  imports: [CurrencyPipe, DishModalComponent],
  templateUrl: './participant-card.component.html',
  styleUrl: './participant-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ParticipantCardComponent {
  readonly participant = input.required<Participant>();
  readonly isOwner = input(false);
  readonly canRemove = input(false);
  readonly removeClick = output<Participant>();
  readonly selectedDish = signal<DishListResponse | null>(null);
  readonly statusLabel = computed(() =>
    this.participant().isSubmitted ? 'Submitted' : 'Still choosing',
  );
  readonly title = computed(() =>
    this.isOwner() ? 'My Pre-Order' : `${this.participant().type}: ${this.participant().name}`,
  );

  openDish(dish: DishShort): void {
    this.selectedDish.set({
      id: dish.id,
      name: dish.name,
      imageUrl: dish.imageUrl || 'assets/img/dish.png',
      price: dish.price,
      state: 'Available',
      weight: dish.weight ?? '',
      dishType: 'MainCourse',
      description: dish.description || 'Description is not available for this dish.',
      calories: dish.calories ?? '—',
      proteins: dish.proteins ?? '—',
      carbohydrates: dish.carbohydrates ?? '—',
      fats: dish.fats ?? '—',
      vitamins: dish.vitamins ?? '—',
    });
  }

  closeDish(): void {
    this.selectedDish.set(null);
  }
}
