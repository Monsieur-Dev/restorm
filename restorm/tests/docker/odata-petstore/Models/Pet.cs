using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace OData.PetStore.Models;

public enum PetStatus
{
    Available,
    Pending,
    Sold
}

public class Pet
{
    [Key]
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public PetStatus Status { get; set; } = PetStatus.Available;

    public List<string> PhotoUrls { get; set; } = new();

    [ForeignKey(nameof(Category))]
    public int? CategoryId { get; set; }

    public Category? Category { get; set; }

    public List<Tag> Tags { get; set; } = new();

    [ForeignKey(nameof(Owner))]
    public int? OwnerId { get; set; }

    public Owner? Owner { get; set; }
}
