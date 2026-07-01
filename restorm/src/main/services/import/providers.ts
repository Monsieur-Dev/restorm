/**
 * Side-effect barrel: importing this module triggers every import provider to
 * self-register into the shared `importProviders` registry.
 *
 * The registration order here determines the detection priority inside
 * `detectFormat` — it matches the original hard-coded if/else order so the
 * format-sniffing results are identical to the pre-registry behaviour.
 *
 * To add a new format: implement `<Format>ImportService.ts`, add
 * `importProviders.push(...)` at its bottom, then add ONE line here.
 */

// Text-prefix formats (cheapest detection — checked before JSON parsing)
import './CurlImportService'
import './PowerShellImportService'
import './RestClientImportService'

// JSON-keyed formats (detection requires JSON.parse — registered in the same
// order the original switch tried them to preserve tiebreaking)
import './SwaggerImportService'
import './OpenAPIImportService'
import './PostmanImportService'
import './InsomniaImportService'
import './BrunoImportService'
import './AsyncAPIImportService'
import './ODataImportService'
import './HarImportService'
import './ThunderClientImportService'
import './PawImportService'
import './HttpieImportService'

// Non-JSON text/XML formats
import './GraphQLImportService'
import './GrpcImportService'
import './SoapImportService'

// Modern API modeling formats (accept either a JSON-keyed AST or their own
// text IDL — detection tries the JSON branch first, falls back to the IDL sniff)
import './SmithyImportService'

export { importProviders } from './registry'
