# Multi-stage build — SDK to compile, aspnet runtime to serve.
# Alpine-based to keep the final image small.
# Mirrors the shape of tests/docker/odata-petstore/Dockerfile so the CI
# build + run steps stay homogeneous.

FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src

COPY AuthService.csproj .
RUN dotnet restore AuthService.csproj

COPY . .
RUN dotnet publish AuthService.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .

EXPOSE 5110
ENV ASPNETCORE_URLS=http://0.0.0.0:5110
ENV ASPNETCORE_ENVIRONMENT=Production

ENTRYPOINT ["dotnet", "AuthService.dll"]
