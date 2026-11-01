using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Constants;
using APIHandler.Entities;
using APIHandler.Handlers.Order;
using APIHandler.Repositories.Reservations;
using APIHandler.Services.Dishes;
using APIHandler.Services.Orders;
using Moq;
using System.Text.Json;

namespace APIHandler.Tests.Services;

public class GetOrdersByCustomerHandlerTests
{
    [Fact]
    public async Task HandleRequest_ShouldOmitOrdersForCancelledReservations()
    {
        var orderService = new Mock<IOrderService>();
        var reservationRepository = new Mock<IReservationRepository>();
        var dishService = new Mock<IDishService>();
        var logger = new Mock<ILambdaLogger>();
        var context = new Mock<ILambdaContext>();
        context.Setup(lambdaContext => lambdaContext.Logger).Returns(logger.Object);

        orderService
            .Setup(service => service.GetOrdersByCustomerIdAsync("customer-1"))
            .ReturnsAsync(new[]
            {
                CreateOrder("active-order", "active-reservation"),
                CreateOrder("stale-order", "cancelled-reservation"),
            });
        reservationRepository
            .Setup(repository => repository.GetReservationsByCustomerIdAsync("customer-1"))
            .ReturnsAsync(new[]
            {
                CreateReservation("cancelled-reservation", ReservationStatus.Cancelled),
            });
        dishService
            .Setup(service => service.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync(Array.Empty<Dish>());

        var handler = new GetOrdersByCustomerHandler(
            dishService.Object,
            orderService.Object,
            reservationRepository.Object);
        var request = new APIGatewayProxyRequest
        {
            RequestContext = new APIGatewayProxyRequest.ProxyRequestContext
            {
                Authorizer = new APIGatewayCustomAuthorizerContext
                {
                    Claims = new Dictionary<string, string>
                    {
                        ["sub"] = "customer-1",
                    },
                },
            },
        };

        var response = await handler.HandleRequest(request, context.Object);

        Assert.Equal(200, response.StatusCode);
        using var responseJson = JsonDocument.Parse(response.Body);
        var orderIds = responseJson.RootElement
            .EnumerateArray()
            .Select(order => order.GetProperty("orderId").GetString())
            .ToArray();

        Assert.Equal(new[] { "active-order" }, orderIds);
    }

    private static Order CreateOrder(string orderId, string reservationId) => new()
    {
        OrderId = orderId,
        CustomerId = "customer-1",
        ReservationId = reservationId,
        ReservationAddress = "Test address",
        ReservationTime = "Nov 2, 2026, 5:15 PM - 6:45 PM",
        Dishes = [],
        Status = OrderStatus.Created,
    };

    private static Reservation CreateReservation(string reservationId, ReservationStatus status) => new()
    {
        Id = reservationId,
        TableId = "table-1",
        CustomerId = "customer-1",
        WaiterId = "waiter-1",
        StartTime = DateTime.UtcNow.AddDays(1),
        EndTime = DateTime.UtcNow.AddDays(1).AddHours(1),
        GuestCount = 2,
        Status = status,
    };
}
