using System.ComponentModel.DataAnnotations;

namespace OData.PetStore.Models;

public class Tag
{
    [Key]
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;
}
