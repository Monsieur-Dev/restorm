using Microsoft.AspNetCore.OData;
using Microsoft.AspNetCore.OData.Batch;
using Microsoft.OData.ModelBuilder;
using OData.PetStore.Models;

var builder = WebApplication.CreateBuilder(args);

// In-memory store — one singleton for the whole process. The state
// resets on container restart, which is exactly what we want for e2e
// determinism.
builder.Services.AddSingleton<OData.PetStore.Data.PetStore>();

// EDM model: entity sets, bound/unbound actions, unbound functions.
var model = BuildEdmModel();

builder.Services
    .AddControllers()
    .AddOData(options => options
        .EnableQueryFeatures(maxTopValue: 100)
        .AddRouteComponents("odata", model, new DefaultODataBatchHandler()));

// Forward `/` → /odata so a bare `GET http://host:5100/` reaches the
// service document without requiring users to remember the prefix.
var app = builder.Build();

app.UseRouting();
app.UseODataBatching();
app.MapControllers();

// Liveness probe: the e2e fixture polls this to wait for startup.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

static Microsoft.OData.Edm.IEdmModel BuildEdmModel()
{
    var odata = new ODataConventionModelBuilder();
    odata.EntitySet<Pet>("Pets");
    odata.EntitySet<Category>("Categories");
    odata.EntitySet<Tag>("Tags");
    odata.EntitySet<Owner>("Owners");

    // Bound action: AdoptPet(ownerId) → assigns owner + flips Status = Sold.
    var adoptAction = odata.EntityType<Pet>().Action("AdoptPet");
    adoptAction.Parameter<int>("OwnerId");
    adoptAction.ReturnsFromEntitySet<Pet>("Pets");

    // Unbound function: GetAvailablePets(category) → collection of Pets.
    var getAvailable = odata.Function("GetAvailablePets");
    getAvailable.Parameter<string>("category");
    getAvailable.ReturnsCollectionFromEntitySet<Pet>("Pets");

    return odata.GetEdmModel();
}
