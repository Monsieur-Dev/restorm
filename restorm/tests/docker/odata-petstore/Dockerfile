# Multi-stage build — SDK to compile, aspnet runtime to serve.
# Alpine-based to keep the final image small (~100 MB).

FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src

# Restore first so package cache is reusable across code changes.
COPY OData.PetStore.csproj .
RUN dotnet restore OData.PetStore.csproj

COPY . .
RUN dotnet publish OData.PetStore.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 5100
ENV ASPNETCORE_URLS=http://0.0.0.0:5100
ENV ASPNETCORE_ENVIRONMENT=Production

ENTRYPOINT ["dotnet", "OData.PetStore.dll"]
