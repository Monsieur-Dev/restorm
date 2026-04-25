using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OData.Query;
using Microsoft.AspNetCore.OData.Routing.Controllers;
using OData.PetStore.Data;
using OData.PetStore.Models;

namespace OData.PetStore.Controllers;

/// <summary>
/// OData controller for the <c>Pets</c> entity set.
///
/// <list type="bullet">
///   <item><c>GET /odata/Pets</c> — full list, supports
///   <c>$filter</c>/<c>$select</c>/<c>$expand</c>/<c>$orderby</c>/
///   <c>$top</c>/<c>$skip</c>/<c>$count</c>.</item>
///   <item><c>GET /odata/Pets(id)</c> — single entity.</item>
///   <item><c>POST /odata/Pets</c> — create.</item>
///   <item><c>PATCH /odata/Pets(id)</c> — partial update.</item>
///   <item><c>DELETE /odata/Pets(id)</c> — remove.</item>
///   <item><c>POST /odata/Pets(id)/OData.PetStore.Models.AdoptPet</c>
///   — bound action assigning an owner and flipping status to Sold.</item>
///   <item><c>GET /odata/Pets/OData.PetStore.Models.GetAvailablePets(category='Dogs')</c>
///   — unbound function filtering by category name.</item>
/// </list>
/// </summary>
public class PetsController : ODataController
{
    private readonly Data.PetStore _store;

    public PetsController(Data.PetStore store)
    {
        _store = store;
    }

    [EnableQuery(PageSize = 50, MaxExpansionDepth = 3)]
    public IActionResult Get()
    {
        return Ok(_store.Pets.AsQueryable());
    }

    [EnableQuery]
    public IActionResult Get([FromRoute] int key)
    {
        var pet = _store.Pets.FirstOrDefault(p => p.Id == key);
        if (pet is null) return NotFound();
        return Ok(pet);
    }

    public IActionResult Post([FromBody] Pet pet)
    {
        pet.Id = _store.NextPetId();
        if (pet.CategoryId.HasValue)
        {
            pet.Category = _store.Categories.FirstOrDefault(c => c.Id == pet.CategoryId.Value);
        }
        if (pet.OwnerId.HasValue)
        {
            pet.Owner = _store.Owners.FirstOrDefault(o => o.Id == pet.OwnerId.Value);
        }
        _store.Pets.Add(pet);
        return Created(pet);
    }

    public IActionResult Patch([FromRoute] int key, [FromBody] Microsoft.AspNetCore.OData.Deltas.Delta<Pet> delta)
    {
        var pet = _store.Pets.FirstOrDefault(p => p.Id == key);
        if (pet is null) return NotFound();
        delta.Patch(pet);
        return Updated(pet);
    }

    public IActionResult Delete([FromRoute] int key)
    {
        var pet = _store.Pets.FirstOrDefault(p => p.Id == key);
        if (pet is null) return NotFound();
        _store.Pets.Remove(pet);
        return NoContent();
    }

    /// <summary>Bound action: assign an owner and flip status to Sold.</summary>
    [HttpPost("odata/Pets({key})/OData.PetStore.Models.AdoptPet")]
    public IActionResult AdoptPet([FromRoute] int key, [FromBody] AdoptPetParameters parameters)
    {
        var pet = _store.Pets.FirstOrDefault(p => p.Id == key);
        if (pet is null) return NotFound();
        var owner = _store.Owners.FirstOrDefault(o => o.Id == parameters.OwnerId);
        if (owner is null) return NotFound($"Owner {parameters.OwnerId} not found");

        pet.OwnerId = owner.Id;
        pet.Owner = owner;
        pet.Status = PetStatus.Sold;
        return Ok(pet);
    }

    /// <summary>Unbound function: filter pets by category name (case-insensitive).</summary>
    [EnableQuery]
    [HttpGet("odata/GetAvailablePets(category={category})")]
    public IActionResult GetAvailablePets([FromRoute] string category)
    {
        var trimmed = category.Trim('\'', '"');
        var query = _store.Pets.Where(p => p.Status == PetStatus.Available);
        if (!string.IsNullOrEmpty(trimmed))
        {
            query = query.Where(p => p.Category != null
                && string.Equals(p.Category.Name, trimmed, StringComparison.OrdinalIgnoreCase));
        }
        return Ok(query.AsQueryable());
    }
}

public class AdoptPetParameters
{
    public int OwnerId { get; set; }
}
