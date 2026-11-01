using APIHandler.Constants;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Models.GroupReservation;
using APIHandler.Models.GuestReservation;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using APIHandler.Services.Auth;
using APIHandler.Services.Locations;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace APIHandler.Services.GroupReservations;

public class GroupReservationService(
    IGroupReservationRepository groupReservationRepository,
    ITableRepository tableRepository,
    IReservationRepository reservationRepository,
    IGuestSessionRepository guestSessionRepository,
    IUserService userService,
    ILocationService locationService) : IGroupReservationService
{
    private const string DefaultRestaurantName = "Green & Tasty";

    public async Task<GetGroupReservationResponse> GetGroupReservationByTokenAsync(string token)
    {
        GroupReservation groupReservation =
            await groupReservationRepository.GetGroupReservationByTokenAsync(token)
            ?? throw new GroupReservationNotFoundException();

        if (groupReservation.Status == GroupReservationStatus.Closed)
            throw new GroupReservationExpiredException();

        Task<Reservation?> reservationTask =
            reservationRepository.GetReservationByIdAsync(groupReservation.ReservationId);

        Reservation reservation =
            await reservationTask
            ?? throw new ValidationException("Associated reservation not found.");

        // Owner-сесія також зберігається в GuestSessions.
        // Тому віднімаємо її з кількості запрошених гостей.
        Table table = await tableRepository.GetTableAsync(reservation.TableId)
            ?? throw new InvalidOperationException("Associated table not found.");

        Location? location =
            await locationService.GetLocationByIdAsync(table.LocationId);

        string restaurantName = DefaultRestaurantName;
        string address = location?.Address ?? "Unknown Address";

        string inviterName = "Unknown";

        if (!string.IsNullOrWhiteSpace(reservation.CustomerId))
        {
            inviterName =
                await userService.GetUserName(reservation.CustomerId)
                ?? "Unknown";
        }

        return new GetGroupReservationResponse(
            groupReservation.GroupReservationId,
            table.LocationId,
            restaurantName,
            address,
            reservation.StartTime,
            reservation.EndTime,
            reservation.GuestCount,
            table.TableNumber,
            inviterName);
    }

    public async Task<GroupReservation> GetGroupReservationAsync(string groupReservationId)
    {
        GroupReservation? groupReservation =
            await groupReservationRepository.GetGroupReservationByIdAsync(groupReservationId);

        return groupReservation
            ?? throw new InvalidOperationException(
                $"Group reservation with ID {groupReservationId} not found.");
    }

    public async Task<GroupReservation> CreateGroupReservationAsync(string reservationId)
    {
        // 1. Отримуємо основне бронювання.
        Reservation reservation =
            await reservationRepository.GetReservationByIdAsync(reservationId)
            ?? throw new ReservationNotFoundException(
                $"Reservation {reservationId} was not found.");

        // 2. Перевіряємо наявність власника.
        if (string.IsNullOrWhiteSpace(reservation.CustomerId))
        {
            throw new ValidationException(
                "Reservation does not have an owner.");
        }

        // 3. Створюємо групове бронювання.
        var groupReservation = new GroupReservation
        {
            GroupReservationId = Guid.NewGuid().ToString(),
            ReservationId = reservationId,
            ReservationToken = Guid.NewGuid().ToString("N"),
            Status = GroupReservationStatus.Open
        };

        await groupReservationRepository.SaveGroupReservationAsync(groupReservation);

        // 4. Отримуємо ім'я власника.
        string ownerName =
            await userService.GetUserName(reservation.CustomerId)
            ?? "Owner";

        // 5. Створюємо Owner-сесію.
        var ownerSession = new GuestSession
        {
            Id = Guid.NewGuid().ToString(),
            GroupReservationId = groupReservation.GroupReservationId,
            GuestName = ownerName,
            Dishes = new List<OrderItem>(),
            SessionTokenHash = null,
            IsOwnerSession = true,
            OwnerUserId = reservation.CustomerId,
            IsSubmitted = false
        };

        // 6. Зберігаємо Owner-сесію.
        await guestSessionRepository.SaveAsync(ownerSession);

        return groupReservation;
    }

    public async Task<GroupReservation> CreateGroupReservationIfDoesNotExistAsync(
        string userId,
        string reservationId)
    {
        GroupReservation? group =
            await groupReservationRepository.GetByReservationIdAsync(reservationId);

        if (group is not null)
            return group;

        return await CreateGroupReservationAsync(reservationId);
    }

    public async Task UpdateGroupReservationStatusAsync(
        string groupReservationId,
        GroupReservationStatus status)
    {
        var groupReservation =
            await GetGroupReservationAsync(groupReservationId);

        groupReservation.Status = status;

        await groupReservationRepository.SaveGroupReservationAsync(groupReservation);
    }

    public async Task DeleteGroupReservationAsync(string groupReservationId)
    {
        var groupReservation =
            await GetGroupReservationAsync(groupReservationId);

        await groupReservationRepository.DeleteGroupReservationAsync(groupReservation);
    }

    public async Task CloseGroupReservationAsync(string reservationId)
    {
        GroupReservation? groupReservation =
            await groupReservationRepository.GetByReservationIdAsync(reservationId);

        if (groupReservation is null)
            return;

        groupReservation.Status = GroupReservationStatus.Closed;

        await groupReservationRepository.SaveGroupReservationAsync(groupReservation);
    }

    public async Task<GetGroupInviteTokenResponse> GetGroupReservationInviteTokenAsync(
        string reservationId)
    {
        var reservation =
            await reservationRepository.GetReservationByIdAsync(reservationId)
            ?? throw new ReservationNotFoundException(
                $"Reservation {reservationId} was not found.");

        if (reservation.GuestCount < 2)
        {
            throw new ValidationException(
                "Retrieving invitation token for the reservation with only one guest is not permitted.");
        }

        if (reservation.Status != ReservationStatus.Reserved)
        {
            throw new GroupReservationExpiredException(
                "The group reservation is expired.");
        }

        GroupReservation groupReservation =
            (await groupReservationRepository.GetByReservationIdAsync(reservationId))!;

        if (groupReservation.Status == GroupReservationStatus.Closed)
            throw new GroupReservationExpiredException();

        return new GetGroupInviteTokenResponse(groupReservation.ReservationToken);
    }
}
