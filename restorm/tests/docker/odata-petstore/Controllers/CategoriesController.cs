using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OData.Query;
using Microsoft.AspNetCore.OData.Routing.Controllers;
using OData.PetStore.Models;

namespace OData.PetStore.Controllers;

public class CategoriesController : ODataController
{
    private readonly Data.PetStore _store;

    public CategoriesController(Data.PetStore store)
    {
        _store = store;
    }

    [EnableQuery(PageSize = 100)]
    public IActionResult Get() => Ok(_store.Categories.AsQueryable());

    [EnableQuery]
    public IActionResult Get([FromRoute] int key)
    {
        var c = _store.Categories.FirstOrDefault(x => x.Id == key);
        if (c is null) return NotFound();
        return Ok(c);
    }

    public IActionResult Post([FromBody] Category category)
    {
        category.Id = _store.NextCategoryId();
        _store.Categories.Add(category);
        return Created(category);
    }
}
