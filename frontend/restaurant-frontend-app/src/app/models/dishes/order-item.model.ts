import { DishListResponse } from './dish-list-response.model';

export interface OrderItem {
  dish: DishListResponse;
  quantity: number;
  state?: number;
}
