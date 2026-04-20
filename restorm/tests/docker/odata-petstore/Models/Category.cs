using System.ComponentModel.DataAnnotations;

namespace OData.PetStore.Models;

public class Category
{
    [Key]
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;
}
