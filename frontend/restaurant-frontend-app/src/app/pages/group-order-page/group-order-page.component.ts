import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  Subscription,
  catchError,
  defer,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  forkJoin,
  map,
  of,
  switchMap,
  timer,
} from 'rxjs';

import { Participant } from '@app/models/group-orders/participant.model';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { DEMO_RESERVATION_ID } from '@app/shared/mocks/group-orders/group-orders.mock-store';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { ParticipantCardComponent } from '../../components/group-orders/participant-card/participant-card.component';
import { GROUP_ORDER_PREVIEW } from '../../shared/mocks/group-orders/group-order.preview';

interface GroupOrderView {
  reservationId: string;
  invite: GuestInvite;
  sessions: GroupSessionsResponse;
  status: GroupStatusResponse;
}

interface GroupSnapshot {
  sessions: GroupSessionsResponse;
  status: GroupStatusResponse;
}

const PREVIEW_STATUS: GroupStatusResponse = {
  currentParticipants: GROUP_ORDER_PREVIEW.sessions.participants.length,
  maxCapacity: GROUP_ORDER_PREVIEW.invite.MaxGuestCount,
  status: 'Open',
};

const PREVIEW_ORDER: GroupOrderView = {
  ...GROUP_ORDER_PREVIEW,
  reservationId: DEMO_RESERVATION_ID,
  status: PREVIEW_STATUS,
};

const SYNC_INTERVAL_MS = 15_000;

@Component({
  selector: 'app-group-order-page',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, ParticipantCardComponent, ModalComponent, RouterLink],
  templateUrl: './group-order-page.api.html',
  styleUrl: './group-order-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupOrderPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toastService = inject(ToastService);

  readonly groupOrder = signal<GroupOrderView | null>(PREVIEW_ORDER);
  readonly reservationId = signal('');
  readonly initialLoading = signal(false);
  readonly loadError = signal(false);
  readonly loadErrorMessage = signal("Couldn't load this group pre-order.");
  readonly refreshing = signal(false);
  readonly refreshFailed = signal(false);
  readonly updatedAt = signal<Date | null>(null);
  readonly isSubmitting = signal(false);
  readonly showSubmitConfirmation = signal(false);
  readonly removingGuest = signal(false);
  readonly guestToRemove = signal<Participant | null>(null);

  readonly participants = computed(() => this.groupOrder()?.sessions.participants ?? []);
  readonly consolidatedOrder = computed(() => consolidatePreOrder(this.participants()));
  readonly grandTotal = computed(() => this.consolidatedOrder().total);
  readonly statusLabel = computed(() => {
    switch (this.groupOrder()?.status.status) {
      case 'Open':
        return 'Collecting pre-orders';
      case 'Submitted':
        return 'Sent to Restaurant';
      case 'Closed':
        return 'Pre-orders closed';
      default:
        return '';
    }
  });
  readonly waitingParticipantCount = computed(
    () => this.participants().filter((participant) => !participant.isSubmitted).length,
  );
  readonly canSubmit = computed(
    () =>
      this.groupOrder()?.status.status === 'Open' &&
      this.consolidatedOrder().items.length > 0 &&
      !this.isSubmitting(),
  );

  readonly hasNoDishesToSubmit = computed(
    () =>
      this.groupOrder()?.status.status === 'Open' &&
      this.consolidatedOrder().items.length === 0,
  );

  readonly submitted = computed(() => this.groupOrder()?.status.status === 'Submitted');

  readonly canRemoveGuests = computed(
    () => this.groupOrder()?.status.status === 'Open' && !this.isSubmitting(),
  );

  private pollingSubscription: Subscription | null = null;
  private initialLoadSubscription: Subscription | null = null;

  private get groupOrders(): GroupOrdersService {
    return this.injector.get(GroupOrdersService);
  }

  private get guestInvites(): GuestInviteService {
    return this.injector.get(GuestInviteService);
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      this.initialLoadSubscription?.unsubscribe();
    });
  }

  ngOnInit(): void {
    if (!this.route) {
      return;
    }

    this.route.paramMap
      .pipe(
        map((params) => params.get('reservationId')),
        filter((id): id is string => Boolean(id)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((id) => this.loadReservation(id));
  }

  retryLoad(): void {
    const id = this.reservationId();
    if (id) {
      this.loadReservation(id);
    }
  }

  refreshNow(): void {
    const groupReservationId = this.groupOrder()?.invite.GroupReservationId;
    if (!groupReservationId || this.refreshing()) {
      return;
    }

    this.refreshSnapshot$(groupReservationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((snapshot) => this.applyRefresh(snapshot));
  }

  requestSubmitPreOrder(): void {
    if (this.hasNoDishesToSubmit()) {
      this.toastService.info('Add at least one dish to enable submission.');
      return;
    }

    if (this.canSubmit()) {
      this.showSubmitConfirmation.set(true);
    }
  }

  cancelSubmitPreOrder(): void {
    this.showSubmitConfirmation.set(false);
  }

  confirmSubmitPreOrder(): void {
    const order = this.groupOrder();
    if (!order || !this.canSubmit()) {
      return;
    }

    this.showSubmitConfirmation.set(false);
    this.isSubmitting.set(true);
    this.groupOrders
      .submitGroupPreOrder$(order.invite.GroupReservationId, order.reservationId)
      .pipe(
        finalize(() => this.isSubmitting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.groupOrder.update((current) =>
            current
              ? { ...current, status: { ...current.status, status: 'Submitted' } }
              : current,
          );
          this.stopPolling();
          this.toastService.success('Pre-order sent to the restaurant');
        },
        // The HTTP interceptor presents the backend's message as a toast.
        error: () => undefined,
      });
  }

  askToRemoveGuest(participant: Participant): void {
    if (this.canRemoveGuests() && participant.type === 'Guest') {
      this.guestToRemove.set(participant);
    }
  }

  cancelRemoveGuest(): void {
    if (!this.removingGuest()) {
      this.guestToRemove.set(null);
    }
  }

  confirmRemoveGuest(): void {
    const guest = this.guestToRemove();
    const order = this.groupOrder();
    if (!guest || !order || !this.canRemoveGuests() || this.removingGuest()) {
      return;
    }

    this.removingGuest.set(true);
    this.groupOrders
      .removeSession$(order.invite.GroupReservationId, guest.id)
      .pipe(
        finalize(() => this.removingGuest.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (sessions) => {
          this.groupOrder.update((current) =>
            current
              ? {
                  ...current,
                  sessions,
                  status: {
                    ...current.status,
                    currentParticipants: sessions.participants.length,
                  },
                }
              : current,
          );
          this.updatedAt.set(new Date());
          this.refreshFailed.set(false);
          this.guestToRemove.set(null);
        },
        error: () => undefined,
      });
  }

  private loadReservation(reservationId: string): void {
    this.stopPolling();
    this.initialLoadSubscription?.unsubscribe();
    this.reservationId.set(reservationId);
    this.groupOrder.set(null);
    this.initialLoading.set(true);
    this.loadError.set(false);
    this.loadErrorMessage.set("Couldn't load this group pre-order.");
    this.refreshFailed.set(false);
    this.updatedAt.set(null);

    const initialSnapshot$: Observable<GroupOrderView> = this.guestInvites
      .getInviteToken$(reservationId)
      .pipe(
        switchMap(({ token }) => this.guestInvites.getInvite$(token)),
        switchMap((invite) =>
          forkJoin({
            sessions: this.groupOrders.getSessions$(invite.GroupReservationId),
            status: this.groupOrders.getStatus$(invite.GroupReservationId),
          }).pipe(
            map(({ sessions, status }) => ({
              reservationId,
              invite,
              sessions: this.withOwnerFirst(sessions),
              status,
            })),
          ),
        ),
      );

    this.initialLoadSubscription = initialSnapshot$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          this.groupOrder.set(order);
          this.updatedAt.set(new Date());
          this.initialLoading.set(false);
          if (order.status.status === 'Open') {
            this.startPolling(order.invite.GroupReservationId);
          }
        },
        error: (error: unknown) => {
          this.initialLoading.set(false);
          this.loadError.set(true);
          if (error instanceof HttpErrorResponse && error.status === 404) {
            this.loadErrorMessage.set('Group reservation not found');
          }
        },
      });
  }

  private startPolling(groupReservationId: string): void {
    if (this.pollingSubscription && !this.pollingSubscription.closed) {
      return;
    }

    this.pollingSubscription = timer(SYNC_INTERVAL_MS, SYNC_INTERVAL_MS)
      .pipe(
        exhaustMap(() => this.refreshSnapshot$(groupReservationId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((snapshot) => this.applyRefresh(snapshot));
  }

  private stopPolling(): void {
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = null;
  }

  private refreshSnapshot$(groupReservationId: string): Observable<GroupSnapshot | null> {
    return defer(() => {
      if (this.refreshing()) {
        return EMPTY;
      }

      this.refreshing.set(true);
      return forkJoin({
        sessions: this.groupOrders.getSessions$(groupReservationId, { silent: true }),
        status: this.groupOrders.getStatus$(groupReservationId, { silent: true }),
      }).pipe(
        map((snapshot): GroupSnapshot | null => snapshot),
        catchError(() => {
          this.refreshFailed.set(true);
          return of(null);
        }),
        finalize(() => this.refreshing.set(false)),
      );
    });
  }

  private applyRefresh(snapshot: GroupSnapshot | null): void {
    if (!snapshot) {
      return;
    }

    this.groupOrder.update((current) =>
      current
        ? {
            ...current,
            sessions: this.withOwnerFirst(snapshot.sessions),
            status: snapshot.status,
          }
        : current,
    );
    this.updatedAt.set(new Date());
    this.refreshFailed.set(false);

    if (snapshot.status.status !== 'Open') {
      this.guestToRemove.set(null);
      this.showSubmitConfirmation.set(false);
      this.stopPolling();
    }
  }

  private withOwnerFirst(sessions: GroupSessionsResponse): GroupSessionsResponse {
    return {
      ...sessions,
      participants: [...sessions.participants].sort((left, right) => {
        if (left.type === 'Owner') return -1;
        if (right.type === 'Owner') return 1;
        return 0;
      }),
    };
  }
}
