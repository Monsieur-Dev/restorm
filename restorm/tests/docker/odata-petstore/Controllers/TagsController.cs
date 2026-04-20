using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OData.Query;
using Microsoft.AspNetCore.OData.Routing.Controllers;
using OData.PetStore.Models;

namespace OData.PetStore.Controllers;

public class TagsController : ODataController
{
    private readonly Data.PetStore _store;

    public TagsController(Data.PetStore store)
    {
        _store = store;
    }

    [EnableQuery(PageSize = 100)]
    public IActionResult Get() => Ok(_store.Tags.AsQueryable());

    [EnableQuery]
    public IActionResult Get([FromRoute] int key)
    {
        var t = _store.Tags.FirstOrDefault(x => x.Id == key);
        if (t is null) return NotFound();
        return Ok(t);
    }

    public IActionResult Post([FromBody] Tag tag)
    {
        tag.Id = _store.NextTagId();
        _store.Tags.Add(tag);
        return Created(tag);
    }
}
