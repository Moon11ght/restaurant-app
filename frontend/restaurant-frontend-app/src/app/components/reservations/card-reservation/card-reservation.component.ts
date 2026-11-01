import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnChanges,
  output,
  signal,
} from '@angular/core';
import { Params, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CreateOrderRequest } from '@app/models/cart/create-order-request.model';
import {
  ReservationCustomer,
  ReservationStatusCustomer,
} from '@app/models/reservations/reservation.model';
import { PlaceOrderWaiterComponent } from '@app/components/place-order-waiter/place-order-waiter.component';
import { Roles } from '@app/shared/constants/roles';
import { CustomSelectComponent } from '@app/shared/custom-components/custom-select/custom-select.component';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';

interface ReservationStatusView {
  class: string;
  label: string;
}

interface WaiterPreOrderNavigationData {
  reservationId: string;
  createdByName: string;
  createdByRole: string;
  tableName: string;
}

@Component({
  selector: 'app-card-reservation',
  standalone: true,
  imports: [
    DatePipe,
    CustomSelectComponent,
    PlaceOrderWaiterComponent,
  ],
  templateUrl: './card-reservation.component.html',
  styleUrl: './card-reservation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardReservationComponent implements OnChanges {
  private readonly router = inject(Router);
  private readonly guestInviteService = inject(GuestInviteService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  readonly Roles = Roles;
  readonly ReservationStatusCustomer = ReservationStatusCustomer;

  readonly r = input.required<ReservationCustomer>();
  readonly role = input<string>(Roles.CUSTOMER);
  readonly statusEnum =
    input<Record<number, ReservationStatusView>>({});

  readonly availableTableOptions = input<string[]>([]);

  readonly availableTableOptionsMap =
    input<Map<string, string>>(new Map<string, string>());

  readonly selectedTableLabel = input('');

  readonly createdByName = input<string | undefined>();

  readonly createdByRole =
    input<ReservationCustomer['createdByRole']>();
  readonly tableChanged = output<{
    reservationId: string;
    newTableId: string;
  }>();

  readonly cancelReservation = output<string>();

  readonly editReservation =
    output<ReservationCustomer>();

  readonly postponeReservation =
    output<ReservationCustomer>();

  readonly leaveFeedbackReservation =
    output<ReservationCustomer>();

  readonly updateFeedbackReservation =
    output<ReservationCustomer>();

  readonly sendAnonymousFeedback =
    output<ReservationCustomer>();

  readonly statusChanged = output<{
    id: string;
    newStatus: ReservationStatusCustomer;
  }>();

  readonly preOrder = output<CreateOrderRequest>();
  readonly showWaiterOrderModal = signal(false);
  readonly showCancelConfirmation = signal(false);
  readonly guestSessionLink = signal<string | null>(null);
  readonly guestSessionLinkLoading = signal(false);
  private guestInviteTokenReservationId: string | null = null;

  readonly statusView = computed<ReservationStatusView>(() => {
    const reservation = this.r();

    return (
      this.statusEnum()[reservation.status] ?? {
        class: '',
        label: 'Unknown',
      }
    );
  });

  readonly displayedTableLabel = computed(() => {
    return this.selectedTableLabel() || 'Table (Unknown)';
  });

  readonly creatorName = computed(() => {
    return (
      this.createdByName() ||
      this.r().createdByName ||
      'Unknown'
    );
  });

  readonly creatorRole = computed(() => {
    return (
      this.createdByRole() ||
      this.r().createdByRole ||
      Roles.CUSTOMER
    );
  });

  readonly preOrderItemCount = computed(() => {
    return this.r().preOrder?.orderItems?.length ?? 0;
  });

  readonly canOpenWaiterPreOrder = computed(() => {
    return (
      this.preOrderItemCount() > 0 ||
      this.creatorRole() === Roles.WAITER
    );
  });

  readonly canOpenGroupPreOrder = computed(() => {
    const reservation = this.r();

    return (
      this.role() === Roles.CUSTOMER &&
      reservation.guestCount > 1 &&
      reservation.status !== ReservationStatusCustomer.Cancelled &&
      reservation.status !== ReservationStatusCustomer.Finished
    );
  });

  readonly canShareGuestSessionLink = computed(() => {
    const reservation = this.r();

    return (
      this.role() === Roles.CUSTOMER &&
      reservation.guestCount > 1 &&
      reservation.status === ReservationStatusCustomer.Reserved
    );
  });

  readonly guestSessionLinkIsActive = computed(
    () => this.r().guestInviteLinkAvailable !== false,
  );

  readonly groupPreOrderConfirmed = computed(() => {
    const reservation = this.r();

    return (
      this.role() === Roles.CUSTOMER &&
      reservation.guestCount > 1 &&
      reservation.guestInviteLinkAvailable === false &&
      reservation.hasSubmittedPreOrder === true
    );
  });

  readonly isAnonymous = computed(() => {
    return !this.r().customerId;
  });

  readonly hasFullFeedback = computed(() => {
    const feedback = this.r().feedback;

    return (
      feedback?.cuisineExperience != null &&
      feedback?.service != null
    );
  });

  ngOnChanges(): void {
    this.loadGuestSessionLink();
  }

  private loadGuestSessionLink(): void {
    const reservation = this.r();

    if (!this.canShareGuestSessionLink() || !this.guestSessionLinkIsActive()) {
      this.guestSessionLink.set(null);
      this.guestSessionLinkLoading.set(false);
      this.guestInviteTokenReservationId = null;
      return;
    }

    if (this.guestInviteTokenReservationId === reservation.id) {
      return;
    }

    this.guestInviteTokenReservationId = reservation.id;

    this.guestSessionLinkLoading.set(true);
    this.guestInviteService
      .getInviteToken$(reservation.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ token }) => {
          if (
            this.r().id !== reservation.id ||
            !this.canShareGuestSessionLink() ||
            !this.guestSessionLinkIsActive()
          ) {
            return;
          }

          this.guestSessionLink.set(`${window.location.origin}/join/${token}`);
          this.guestSessionLinkLoading.set(false);
        },
        error: () => {
          if (
            this.r().id !== reservation.id ||
            !this.canShareGuestSessionLink() ||
            !this.guestSessionLinkIsActive()
          ) {
            return;
          }

          this.guestSessionLinkLoading.set(false);
          this.guestInviteTokenReservationId = null;
          this.toastService.error('Could not load the invite link. Please try again later.');
        },
      });
  }

  async onCopyGuestSessionLink(): Promise<void> {
    if (!this.guestSessionLinkIsActive()) {
      this.toastService.info(
        this.groupPreOrderConfirmed()
          ? 'This guest session link is no longer active because the group order has already been confirmed.'
          : 'This guest session link is no longer available.',
      );
      return;
    }

    const link = this.guestSessionLink();
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      this.toastService.success('Guest session link copied.', 'Link copied!');
    } catch {
      this.toastService.error('Could not copy the link. Please try again.');
    }
  }

  onEditReservation(): void {
    if (this.blockForConfirmedGroupPreOrder()) {
      return;
    }

    this.editReservation.emit(this.r());
  }

  onPreOrder(): void {
    if (this.blockForConfirmedGroupPreOrder()) {
      return;
    }

    const reservation = this.r();
    const startTime = new Date(reservation.startTime);
    const endTime = new Date(reservation.endTime);

    const tableLabel =
      reservation.tableName ||
      `Table ${reservation.tableId}`;

    const queryParams: Params = {
      preOrder: 'true',
      reservationId: reservation.id,
      reservationLabel: [
        reservation.locationAddress,
        tableLabel,
        startTime.toDateString(),
        `${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`,
      ].join(', '),
    };

    void this.router.navigate(['/menu'], {
      queryParams,
    });
  }

  onOpenGroupPreOrder(): void {
    void this.router.navigate([
      '/reservations',
      this.r().id,
      'group-order',
    ]);
  }

  onPreOrderWaiter(): void {
    if (this.preOrderItemCount() > 0) {
      this.navigateToWaiterPreOrder();
      return;
    }

    if (this.creatorRole() === Roles.WAITER) {
      this.showWaiterOrderModal.set(true);
    }
  }

  closeWaiterOrderModal(): void {
    this.showWaiterOrderModal.set(false);
  }

  onWaiterOrderCreated(order: CreateOrderRequest): void {
    this.showWaiterOrderModal.set(false);
    this.preOrder.emit(order);
  }

  onTableChange(label: string): void {
    const reservation = this.r();
    const newTableId =
      this.availableTableOptionsMap().get(label);

    if (!newTableId || newTableId === reservation.tableId) {
      return;
    }

    this.tableChanged.emit({
      reservationId: reservation.id,
      newTableId,
    });
  }

  onStatusChange(
    newStatus: ReservationStatusCustomer,
  ): void {
    this.statusChanged.emit({
      id: this.r().id,
      newStatus,
    });
  }

  requestCancelReservation(): void {
    this.showCancelConfirmation.set(true);
  }

  closeCancelConfirmation(): void {
    this.showCancelConfirmation.set(false);
  }

  confirmCancelReservation(): void {
    this.showCancelConfirmation.set(false);
    this.cancelReservation.emit(this.r().id);
  }

  private navigateToWaiterPreOrder(): void {
    const reservation = this.r();

    const navigationData: WaiterPreOrderNavigationData = {
      reservationId: reservation.id,
      createdByName: this.creatorName(),
      createdByRole: this.creatorRole(),
      tableName: reservation.tableName || 'Unknown table',
    };

    sessionStorage.setItem(
      'waiterPreOrderData',
      JSON.stringify(navigationData),
    );

    void this.router.navigate(['/waiter-pre-order'], {
      state: navigationData,
    });
  }

  private blockForConfirmedGroupPreOrder(): boolean {
    if (!this.groupPreOrderConfirmed()) {
      return false;
    }

    this.toastService.info(
      'This action is unavailable because the group order has already been confirmed.',
    );
    return true;
  }
}
