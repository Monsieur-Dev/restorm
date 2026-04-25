using OData.PetStore.Models;

namespace OData.PetStore.Data;

/// <summary>
/// In-memory data store seeded at startup. A singleton instance is
/// registered in <c>Program.cs</c>; controllers read and mutate the
/// lists directly. No persistence between process restarts — the
/// whole point is a clean slate per e2e run.
/// </summary>
public class PetStore
{
    public List<Category> Categories { get; } = new();
    public List<Tag> Tags { get; } = new();
    public List<Owner> Owners { get; } = new();
    public List<Pet> Pets { get; } = new();

    public PetStore()
    {
        Seed();
    }

    private void Seed()
    {
        var dogs = new Category { Id = 1, Name = "Dogs" };
        var cats = new Category { Id = 2, Name = "Cats" };
        var birds = new Category { Id = 3, Name = "Birds" };
        Categories.AddRange(new[] { dogs, cats, birds });

        var puppy = new Tag { Id = 1, Name = "puppy" };
        var kitten = new Tag { Id = 2, Name = "kitten" };
        var rescue = new Tag { Id = 3, Name = "rescue" };
        var trained = new Tag { Id = 4, Name = "trained" };
        Tags.AddRange(new[] { puppy, kitten, rescue, trained });

        Owners.AddRange(new[]
        {
            new Owner { Id = 1, FirstName = "Alice",   LastName = "Martin", Email = "alice@example.com"   },
            new Owner { Id = 2, FirstName = "Bob",     LastName = "Dupont", Email = "bob@example.com"     },
            new Owner { Id = 3, FirstName = "Charlie", LastName = "Singh",  Email = "charlie@example.com" }
        });

        Pets.AddRange(new[]
        {
            new Pet
            {
                Id = 1,
                Name = "Rex",
                Status = PetStatus.Available,
                CategoryId = dogs.Id,
                Category = dogs,
                Tags = new List<Tag> { puppy, trained },
                PhotoUrls = new List<string> { "https://example.com/rex.jpg" }
            },
            new Pet
            {
                Id = 2,
                Name = "Whiskers",
                Status = PetStatus.Available,
                CategoryId = cats.Id,
                Category = cats,
                Tags = new List<Tag> { kitten, rescue },
                PhotoUrls = new List<string>()
            },
            new Pet
            {
                Id = 3,
                Name = "Buddy",
                Status = PetStatus.Sold,
                CategoryId = dogs.Id,
                Category = dogs,
                OwnerId = 1,
                Owner = Owners[0],
                Tags = new List<Tag> { trained },
                PhotoUrls = new List<string> { "https://example.com/buddy.jpg" }
            },
            new Pet
            {
                Id = 4,
                Name = "Shadow",
                Status = PetStatus.Pending,
                CategoryId = cats.Id,
                Category = cats,
                Tags = new List<Tag> { rescue },
                PhotoUrls = new List<string>()
            },
            new Pet
            {
                Id = 5,
                Name = "Tweety",
                Status = PetStatus.Available,
                CategoryId = birds.Id,
                Category = birds,
                Tags = new List<Tag>(),
                PhotoUrls = new List<string>()
            }
        });
    }

    public int NextPetId() => Pets.Count == 0 ? 1 : Pets.Max(p => p.Id) + 1;
    public int NextCategoryId() => Categories.Count == 0 ? 1 : Categories.Max(c => c.Id) + 1;
    public int NextTagId() => Tags.Count == 0 ? 1 : Tags.Max(t => t.Id) + 1;
    public int NextOwnerId() => Owners.Count == 0 ? 1 : Owners.Max(o => o.Id) + 1;
}
