# OData v4 Pet Store — `restorm-odata-petstore`

Minimal OData v4 reference service used by restorm's e2e + manual tests. Built on Microsoft's [`AspNetCoreOData`](https://github.com/OData/AspNetCoreOData) so the surface matches the current canonical OData v4 spec rather than a third-party fork.

State is held in memory and re-seeded at process start — every `docker compose up` gives a clean slate. No database, no persistence.

## Entity sets

| Set | Key | Fields |
| --- | --- | --- |
| `Pets` | `Id: int` | `Name`, `Status` (`Available`/`Pending`/`Sold`), `PhotoUrls: string[]`, `CategoryId`, `Category` (nav), `Tags` (nav-many), `OwnerId`, `Owner` (nav) |
| `Categories` | `Id: int` | `Name` |
| `Tags` | `Id: int` | `Name` |
| `Owners` | `Id: int` | `FirstName`, `LastName`, `Email` |

## Operations

- **Bound action** — `POST /odata/Pets(id)/OData.PetStore.Models.AdoptPet` with body `{ "OwnerId": 2 }`: assigns the owner and flips `Status` to `Sold`.
- **Unbound function** — `GET /odata/GetAvailablePets(category='Dogs')`: returns pets filtered by category name (case-insensitive).
- **Batch** — `POST /odata/$batch`: handled by `DefaultODataBatchHandler`, supports change-sets.

## Query options

All standard v4 options are enabled via `EnableQueryFeatures(maxTopValue=100)`:

- `$filter` / `$select` / `$orderby` / `$top` / `$skip` / `$count` / `$expand` — everywhere.
- `$search` is enabled at the model level but there's no custom search predicate wired (AspNetCoreOData falls back to a noop).
- Max `$expand` depth is 3 on `Pets`.

## Running

```bash
# From tests/docker/
docker compose up -d odata-petstore

# Verify
curl http://localhost:5100/odata/Pets?\$top=2\&\$select=Name,Status
curl http://localhost:5100/odata/\$metadata
curl http://localhost:5100/health
```

## Testing manually from restorm

Point the URL field at `http://localhost:5100/odata/Pets` with OData version `v4`, enable `$count`, set `$select` to `Id, Name, Status`, and hit Send. The response carries `@odata.context`, `@odata.count`, and (on pagination) `@odata.nextLink`.

## Layout

```
Program.cs                 // ASP.NET Core startup + EDM model + batch routing
OData.PetStore.csproj      // .NET 9 web project, AspNetCoreOData 9.x
Dockerfile                 // Multi-stage sdk → aspnet alpine
appsettings.json           // Kestrel binds 0.0.0.0:5100
Models/                    // POCOs (Pet, Category, Tag, Owner) + PetStatus enum
Data/PetStore.cs           // In-memory store + seed data
Controllers/               // ODataController per entity set + bound/unbound ops
```

## Ports

- `5100` — HTTP OData endpoint.

Used alongside the other restorm test fixtures in `../docker-compose.yml`.
