using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace APIHandler.Models.GuestSessions;

public record GetAllSessionsResponse(
    IEnumerable<Participant> Participants,
    decimal Total);

public record Participant(
    string? Id,
    [property: JsonConverter(
        typeof(JsonStringEnumConverter<ParticipantType>))]
    ParticipantType Type,
    string Name,
    IEnumerable<SessionOrderItemResponse> Items,
    decimal Total,
    bool IsSubmitted);

public enum ParticipantType
{
    Owner,
    Guest
}

public record SessionOrderItemResponse(
    SessionDishResponse Dish,
    int Quantity);

public record SessionDishResponse(
    string Id,
    string Name,
    decimal Price,
    string? ImageUrl,
    string Weight,
    string Description,
    string Calories,
    string Proteins,
    string Carbohydrates,
    string Fats,
    string Vitamins);
