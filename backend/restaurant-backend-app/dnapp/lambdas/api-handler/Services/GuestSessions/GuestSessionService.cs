using Amazon.CognitoIdentityProvider.Model;
using APIHandler.Constants;
using APIHandler.Constants.Dishes;
using APIHandler.Constants.Orders;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Mappers;
using APIHandler.Models.GuestSessions;
using APIHandler.Models.Orders;
using APIHandler.Repositories.Auth;
using APIHandler.Repositories.Dishes;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using APIHandler.Repositories.Orders;
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;
using APIHandler.Services.Notifications;

namespace APIHandler.Services.GuestSessions;

public class GuestSessionService(
    IGroupReservationRepository groupReservationRepository,
    IGuestSessionRepository guestSessionRepository,
    IDishRepository dishRepository,
    IReservationRepository reservationRepository,
    IUserRepository userRepository,
    ITableRepository tableRepository,
    IOrderRepository orderRepository) : IGuestSessionService
{
    public async Task<bool> IsAuthorizedAsync(
        string guestSessionToken,
        string guestSessionId)
    {
        string hash = Convert.ToBase64String(
            SHA256.HashData(
                Convert.FromBase64String(guestSessionToken)));

        GuestSession? guestSession =
            await guestSessionRepository.GetByTokenHash(hash);

        if (guestSession is null)
            return false;

        return guestSession.Id == guestSessionId;
    }

    public async Task<CreatGuestSessionResponse> CreateGuestSessionAsync(
        CreateGuestSessionRequest request)
    {
        GroupReservation group =
            await GetGroupReservationAndValidateAsync(
                request.GroupReservationId);

        Reservation reservation =
            await reservationRepository.GetReservationByIdAsync(
                group.ReservationId)
            ?? throw new GroupReservationExpiredException(
                $"Associated reservation for group '{request.GroupReservationId}' not found.");

        if (reservation.Status != ReservationStatus.Reserved)
        {
            throw new GuestSessionExpiredException(
                $"This pre-order session has expired or is no longer active. Current reservation status: '{reservation.Status}'.");
        }

        var sessions = await guestSessionRepository
            .GetAllByGroupReservationIdAsync(group.GroupReservationId);

        int joinedGuestsCount =
            sessions.Count(s => !s.IsOwnerSession);

        if (joinedGuestsCount + 1 >= reservation.GuestCount)
        {
            throw new GuestLimitExceededException(
                $"Guest limit exceeded. Maximum capacity is {reservation.GuestCount}, but {joinedGuestsCount} guests have already joined.");
        }

        byte[] tokenBytes = RandomNumberGenerator.GetBytes(32);

        var session = new GuestSession
        {
            Id = Guid.NewGuid().ToString(),
            GuestName = request.GuestName,
            GroupReservationId = group.GroupReservationId,
            SessionTokenHash = Convert.ToBase64String(
                SHA256.HashData(tokenBytes)),
            Dishes = [],
            IsOwnerSession = false,
            IsSubmitted = false
        };

        await guestSessionRepository.SaveAsync(session);

        return new CreatGuestSessionResponse(
            session.Id,
            Convert.ToBase64String(tokenBytes));
    }

    public async Task<GuestMenuResponse> GetGuestMenuAsync(
        string guestSessionId)
    {
        var session = await guestSessionRepository
            .GetByGuestSessionId(guestSessionId)
            ?? throw new ValidationException(
                $"Guest session '{guestSessionId}' not found.");

        await ValidateGroupReservationId(session.GroupReservationId);

        string locationId =
            await GetLocationIdForGroupAsync(
                session.GroupReservationId);

        var dishes = await dishRepository
            .GetDishesByLocationIdAsync(locationId);

        var dishesMapped = dishes
            .GroupBy(d => d.DishType)
            .ToDictionary(
                k => k.Key,
                GuestMenuDishMapper.Map);

        return new GuestMenuResponse(dishesMapped);
    }

    public async Task AddDishAsync(
        string guestSessionId,
        string dishId,
        int quantity)
    {
        if (quantity <= 0)
        {
            throw new ValidationException(
                $"Quantity ({quantity}) must be greater than zero.");
        }

        GuestSession session =
            await GetGuestSessionAsync(guestSessionId);

        string locationId =
            await GetLocationIdForGroupAsync(
                session.GroupReservationId);

        var locationDishes =
            await dishRepository.GetDishesByLocationIdAsync(locationId);

        var dish = locationDishes.FirstOrDefault(
            d => d.Id == dishId)
            ?? throw new ValidationException(
                $"Dish '{dishId}' does not exist or is not available at this location.");

        if (dish.State != DishState.Available)
        {
            throw new DishIsNotAvailableException(
                $"Dish '{dishId}' is currently unavailable. State: '{dish.State}'.");
        }

        session.Dishes ??= [];

        var existingDish = session.Dishes
            .FirstOrDefault(d => d.DishId == dishId);

        if (existingDish != null)
        {
            existingDish.Quantity += quantity;
        }
        else
        {
            session.Dishes.Add(new OrderItem
            {
                DishId = dishId,
                Quantity = quantity,
                State = OrderItemState.Pending
            });
        }

        await guestSessionRepository.SaveAsync(session);
    }

    public async Task RemoveDishAsync(
        string guestSessionId,
        string dishId,
        int quantity)
    {
        if (quantity <= 0)
        {
            throw new ValidationException(
                "Quantity must be greater than zero.");
        }

        GuestSession session =
            await GetGuestSessionAsync(guestSessionId);

        if (session.Dishes == null || session.Dishes.Count == 0)
        {
            throw new DishNotFoundException(
                $"Dish {dishId} not found in guest session.");
        }

        var existingDish = session.Dishes
            .FirstOrDefault(d => d.DishId == dishId)
            ?? throw new DishNotFoundException(
                $"Dish {dishId} not found in guest session.");

        existingDish.Quantity -= quantity;

        if (existingDish.Quantity <= 0)
        {
            session.Dishes.Remove(existingDish);
        }

        await guestSessionRepository.SaveAsync(session);
    }

    public async Task<GroupReservationStatusResponse>
        GetGroupReservationStatusAsync(string groupReservationId)
    {
        var group = await groupReservationRepository
            .GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        var reservation = await reservationRepository
            .GetReservationByIdAsync(group.ReservationId)
            ?? throw new InvalidOperationException(
                "Associated reservation not found.");

        int currentParticipants =
            await GetCurrentParticipantCountAsync(groupReservationId);

        return new GroupReservationStatusResponse
        {
            CurrentParticipants = currentParticipants,
            MaxCapacity = reservation.GuestCount,
            Status = group.Status
        };
    }

    public async Task<GetAllSessionsResponse> DeleteGuestSessionAsync(
        string userId,
        string groupReservationId,
        string guestSessionId)
    {
        await ValidateReservationOwnerAsync(
            groupReservationId,
            userId);

        var session = await guestSessionRepository
            .GetByGuestSessionId(guestSessionId)
            ?? throw new GuestSessionNotFoundException(
                $"Guest session with id {guestSessionId} not found.");

        if (session.GroupReservationId != groupReservationId)
        {
            throw new ValidationException(
                "Guest session does not belong to this group reservation.");
        }

        if (session.IsOwnerSession)
        {
            throw new ActionForbiddenException(
                "Owner session cannot be deleted.");
        }

        await guestSessionRepository.DeleteAsync(session);

        return await BuildSessionsSnapshotAsync(groupReservationId);
    }

    public async Task<GetAllSessionsResponse> GetAllSessionsAsync(
        string userId,
        string groupReservationId)
    {
        await ValidateReservationOwnerAsync(
            groupReservationId,
            userId);

        return await BuildSessionsSnapshotAsync(groupReservationId);
    }

    public async Task<string> GetOwnerGuestSessionIdAsync(
        string userId,
        string reservationId)
    {
        var reservation = await reservationRepository
            .GetReservationByIdAsync(reservationId)
            ?? throw new ReservationNotFoundException(
                $"Reservation '{reservationId}' not found.");

        if (!string.Equals(
                reservation.CustomerId,
                userId,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new ActionForbiddenException(
                "Only the reservation owner can access the owner guest session.");
        }

        var groupReservation = await groupReservationRepository
            .GetByReservationIdAsync(reservationId)
            ?? throw new GroupReservationNotFoundException();

        var ownerSession = (await guestSessionRepository
                .GetAllByGroupReservationIdAsync(
                    groupReservation.GroupReservationId))
            .FirstOrDefault(session =>
                session.IsOwnerSession &&
                string.Equals(session.OwnerUserId, userId, StringComparison.OrdinalIgnoreCase));

        return ownerSession?.Id
            ?? throw new GuestSessionNotFoundException(
                "Owner guest session was not found.");
    }

    private async Task<GetAllSessionsResponse> BuildSessionsSnapshotAsync(
        string groupReservationId)
    {
        var sessions = await guestSessionRepository
            .GetAllByGroupReservationIdAsync(groupReservationId);

        Order? ownerOrder = null;
        string? ownerName = null;

        if (sessions.Any(s => s.IsOwnerSession))
        {
            var groupReservation =
                await groupReservationRepository
                    .GetGroupReservationByIdAsync(groupReservationId)
                ?? throw new GroupReservationNotFoundException();

            var reservation =
                await reservationRepository
                    .GetReservationByIdAsync(groupReservation.ReservationId)
                ?? throw new ReservationNotFoundException(
                    "Parent reservation not found.");

            ownerOrder = await orderRepository
                .GetOrderByReservationIdAsync(reservation.Id);

            var user = await userRepository
                .GetUserByIdAsync(reservation.CustomerId!);

            ownerName = user?.Attributes
                .FirstOrDefault(a => a.Name == "given_name")
                ?.Value ?? "Owner";
        }

        var dishIds = sessions
            .SelectMany(s => s.IsOwnerSession
                ? ownerOrder?.Dishes ?? []
                : s.Dishes ?? [])
            .Select(d => d.DishId)
            .Distinct()
            .ToArray();

        var allDishes = await dishRepository
            .GetDishesByIdsAsync(dishIds);

        var dishesById = allDishes.ToDictionary(d => d.Id);

        var participants = new List<Participant>();

        foreach (var guestSession in sessions)
        {
            var sessionDishes = guestSession.IsOwnerSession
                ? ownerOrder?.Dishes ?? []
                : guestSession.Dishes ?? [];

            var items = sessionDishes
                .Select(d =>
                {
                    if (!dishesById.TryGetValue(d.DishId, out var dish))
                    {
                        throw new ValidationException(
                            $"Dish '{d.DishId}' referenced by guest session '{guestSession.Id}' was not found.");
                    }

                    return new SessionOrderItemResponse(
                        new SessionDishResponse(
                            dish.Id,
                            dish.Name,
                            dish.Price,
                            dish.ImageUrl,
                            dish.Weight,
                            dish.Description,
                            dish.Calories,
                            dish.Proteins,
                            dish.Carbohydrates,
                            dish.Fats,
                            dish.Vitamins),
                        d.Quantity);
                })
                .ToArray();

            decimal total = items.Sum(
                i => i.Quantity * i.Dish.Price);

            var participantType = guestSession.IsOwnerSession
                ? ParticipantType.Owner
                : ParticipantType.Guest;

            string participantName = guestSession.IsOwnerSession
                ? ownerName ?? "Owner"
                : guestSession.GuestName;

            var participant = new Participant(
                guestSession.Id,
                participantType,
                participantName,
                items,
                total,
                guestSession.IsOwnerSession
                    ? sessionDishes.Count > 0
                    : guestSession.IsSubmitted
            );

            participants.Add(participant);
        }

        return new GetAllSessionsResponse(
            participants,
            participants.Sum(p => p.Total)
        );
    }

    public async Task SubmitCartAsync(string guestSessionId)
    {
        GuestSession guestSession =
            await GetGuestSessionAsync(guestSessionId);

        if (!guestSession.Dishes.Any())
            throw new CartIsEmptyException();

        await ValidateDishesAsync(guestSession.Dishes);

        guestSession.IsSubmitted = true;

        await guestSessionRepository.SaveAsync(guestSession);
    }

    public async Task<List<ConsolidatedOrderItemResponse>> SubmitGroupPreOrderAsync(
        string userId,
        string groupReservationId,
        string reservationId)
    {
        var group = await groupReservationRepository
            .GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        if (group.Status == GroupReservationStatus.Submitted)
        {
            throw new GroupReservationSubmittedException();
        }

        if (group.Status == GroupReservationStatus.Closed)
        {
            throw new GroupReservationExpiredException();
        }

        if (!string.Equals(group.ReservationId, reservationId, StringComparison.Ordinal))
        {
            throw new ValidationException(
                "Reservation does not belong to this group reservation.");
        }

        var reservation = await reservationRepository
            .GetReservationByIdAsync(reservationId)
            ?? throw new ReservationNotFoundException("Reservation not found.");

        if (!string.Equals(reservation.CustomerId, userId, StringComparison.OrdinalIgnoreCase))
        {
            throw new ActionForbiddenException(
                "Only the reservation owner can submit this group pre-order.");
        }

        var sessions = await guestSessionRepository
            .GetAllByGroupReservationIdAsync(groupReservationId);
        var submittedGuestSessions = sessions
            .Where(session => !session.IsOwnerSession && session.IsSubmitted)
            .ToArray();

        var order = await orderRepository.GetOrderByReservationIdAsync(reservationId)
            ?? throw new ValidationException(
                "No pre-order found for the given reservation.");

        var consolidatedItems = order.Dishes
            .Concat(submittedGuestSessions.SelectMany(session => session.Dishes ?? []))
            .GroupBy(item => item.DishId)
            .Select(grouping => new ConsolidatedOrderItemResponse(
                grouping.Key,
                grouping.Sum(item => item.Quantity)))
            .ToList();

        if (consolidatedItems.Count == 0)
        {
            throw new CartIsEmptyException();
        }

        order.Dishes = consolidatedItems
            .Select(item => new OrderItem
            {
                DishId = item.DishId,
                Quantity = item.Quantity,
                State = OrderItemState.Pending
            })
            .ToList();
        order.Status = OrderStatus.SubmittedByCustomer;

        await orderRepository.SaveOrderAsync(order);

        group.Status = GroupReservationStatus.Submitted;
        await groupReservationRepository.SaveGroupReservationAsync(group);

        return consolidatedItems;
    }

    private async Task<GroupReservation>
        GetGroupReservationAndValidateAsync(string groupReservationId)
    {
        GroupReservation? group =
            await groupReservationRepository
                .GetGroupReservationByIdAsync(groupReservationId);

        ValidateGroupReservation(group);

        return group;
    }

    private async Task<int> GetCurrentParticipantCountAsync(
        string groupReservationId)
    {
        var sessions = await guestSessionRepository
            .GetAllByGroupReservationIdAsync(groupReservationId);

        int guestCount =
            sessions.Count(s => !s.IsOwnerSession);

        return guestCount + 1;
    }

    private async Task ValidateGroupReservationId(
        string groupReservationId)
    {
        await GetGroupReservationAndValidateAsync(
            groupReservationId);
    }

    private static void ValidateGroupReservation(
        [NotNull] GroupReservation? group)
    {
        if (group is null)
            throw new GroupReservationNotFoundException();

        if (group.Status == GroupReservationStatus.Closed)
            throw new GroupReservationExpiredException();

        if (group.Status == GroupReservationStatus.Submitted)
            throw new GroupReservationSubmittedException();
    }

    private async Task<GuestSession> GetGuestSessionAsync(
        string sessionId)
    {
        var session = await guestSessionRepository
            .GetByGuestSessionId(sessionId)
            ?? throw new GuestSessionNotFoundException(
                $"Guest session {sessionId} not found.");

        if (session.IsSubmitted)
            throw new GuestSessionSubmittedException();

        await ValidateGroupReservationId(
            session.GroupReservationId);

        return session;
    }

    private async Task ValidateDishesAsync(
        IEnumerable<OrderItem> orders)
    {
        IEnumerable<string> dishIds = orders
            .Select(o => o.DishId)
            .ToArray();

        IEnumerable<Dish> dishes =
            await dishRepository.GetDishesByIdsAsync(dishIds);

        if (dishes.FirstOrDefault(
                d => d.State != DishState.Available) is Dish dish)
        {
            throw new DishIsNotAvailableException(
                $"The dish '{dish.Name}' ({dish.Id}) is not available.");
        }
    }

    private async Task<string> GetLocationIdForGroupAsync(
        string groupReservationId)
    {
        var group = await groupReservationRepository
            .GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        var reservation = await reservationRepository
            .GetReservationByIdAsync(group.ReservationId)
            ?? throw new ReservationNotFoundException(
                "Parent reservation not found.");

        var table = await tableRepository
            .GetTableAsync(reservation.TableId)
            ?? throw new ValidationException(
                "Associated table not found.");

        return table.LocationId;
    }

    private async Task ValidateReservationOwnerAsync(
        string groupReservationId,
        string userId)
    {
        var group = await groupReservationRepository
            .GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        var reservation = await reservationRepository
            .GetReservationByIdAsync(group.ReservationId)
            ?? throw new ReservationNotFoundException(
                "Parent reservation not found.");

        if (reservation.CustomerId != userId)
        {
            throw new ActionForbiddenException(
                "Only the reservation owner can perform this action.");
        }
    }

    public async Task CreateGroupOwnerSessionAsync(
        string userId,
        string groupReservationId)
    {
        await ValidateReservationOwnerAsync(
            groupReservationId,
            userId);

        var sessions = await guestSessionRepository
            .GetAllByGroupReservationIdAsync(groupReservationId);

        if (sessions.Any(s => s.IsOwnerSession))
            return;

        var session = new GuestSession
        {
            Id = Guid.NewGuid().ToString(),
            GroupReservationId = groupReservationId,
            GuestName = "Owner",
            Dishes = [],
            IsOwnerSession = true,
            OwnerUserId = userId,
            IsSubmitted = false
        };

        await guestSessionRepository.SaveAsync(session);
    }

    public async Task<GetGuestSessionResponse> GetGuestSessionInfoAsync(
        string guestSessionId)
    {
        var session = await guestSessionRepository
            .GetByGuestSessionId(guestSessionId)
            ?? throw new GuestSessionNotFoundException(
                "Guest session was not found.");

        var dishIds = session.Dishes
            .Select(s => s.DishId)
            .Distinct()
            .ToArray();

        var allDishes = await dishRepository
            .GetDishesByIdsAsync(dishIds);

        var dishesById = allDishes.ToDictionary(d => d.Id);

        var items = session.Dishes
            .Select(d => new OrderItemResponse
            {
                Dish = DishMapper.ToDishResponse(
                    dishesById[d.DishId]),
                Quantity = d.Quantity,
                State = (int)d.State
            })
            .ToArray();

        decimal total = items.Sum(
            i => i.Quantity * i.Dish.Price);

        string name = session.GuestName;

        if (session.IsOwnerSession)
        {
            var groupReservation =
                await groupReservationRepository
                    .GetGroupReservationByIdAsync(
                        session.GroupReservationId);

            var reservation =
                await reservationRepository
                    .GetReservationByIdAsync(
                        groupReservation!.ReservationId);

            var user = await userRepository
                .GetUserByIdAsync(reservation!.CustomerId!);

            name = user!.Attributes
                .First(a => a.Name == "given_name")
                .Value;
        }

        return new GetGuestSessionResponse(
            name,
            items,
            total,
            session.IsSubmitted);
    }
}
