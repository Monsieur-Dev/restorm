$version: "2"

namespace example.weather

/// Provides weather forecasts.
service Weather {
    version: "2006-03-01"
    resources: [City]
    operations: [GetServerTime]
}

resource City {
    identifiers: { cityId: CityId }
    read: GetCity
    list: ListCities
    resources: [Forecast]
}

resource Forecast {
    identifiers: { cityId: CityId }
    read: GetForecast
}

@pattern("^[A-Za-z0-9 ]+$")
string CityId

@readonly
@http(method: "GET", uri: "/cities/{cityId}")
operation GetCity {
    input: GetCityInput
    output: GetCityOutput
    errors: [NoSuchResource]
}

structure GetCityInput {
    @required
    @httpLabel
    cityId: CityId
}

structure GetCityOutput {
    @required
    name: String

    @required
    coordinates: CityCoordinates
}

structure CityCoordinates {
    @required
    latitude: Float

    @required
    longitude: Float
}

@error("client")
structure NoSuchResource {
    @required
    resourceType: String
}

@readonly
@http(method: "GET", uri: "/cities")
operation ListCities {
    input: ListCitiesInput
    output: ListCitiesOutput
}

structure ListCitiesInput {
    @httpQuery("nextToken")
    nextToken: String

    @httpQuery("pageSize")
    pageSize: Integer
}

structure ListCitiesOutput {
    nextToken: String

    @required
    items: CitySummaries
}

structure CitySummary {
    @required
    cityId: CityId

    @required
    name: String
}

@readonly
@http(method: "GET", uri: "/cities/{cityId}/forecast")
operation GetForecast {
    input: GetForecastInput
    output: GetForecastOutput
}

structure GetForecastInput {
    @required
    @httpLabel
    cityId: CityId

    @httpQuery("unit")
    unit: TemperatureUnit
}

structure GetForecastOutput {
    chanceOfRain: Float
}

enum TemperatureUnit {
    CELSIUS
    FAHRENHEIT
}

@readonly
operation GetServerTime {
    input: GetServerTimeInput
    output: GetServerTimeOutput
}

structure GetServerTimeInput {}

structure GetServerTimeOutput {
    @required
    time: Timestamp
}
