using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OData.Query;
using Microsoft.AspNetCore.OData.Routing.Controllers;
using OData.PetStore.Models;

namespace OData.PetStore.Controllers;

public class OwnersController : ODataController
{
    private readonly Data.PetStore _store;

    public OwnersController(Data.PetStore store)
    {
        _store = store;
    }

    [EnableQuery(PageSize = 100)]
    public IActionResult Get() => Ok(_store.Owners.AsQueryable());

    [EnableQuery]
    public IActionResult Get([FromRoute] int key)
    {
        var o = _store.Owners.FirstOrDefault(x => x.Id == key);
        if (o is null) return NotFound();
        return Ok(o);
    }

    public IActionResult Post([FromBody] Owner owner)
    {
        owner.Id = _store.NextOwnerId();
        _store.Owners.Add(owner);
        return Created(owner);
    }
}
