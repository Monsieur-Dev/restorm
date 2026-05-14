/**
 * Service for importing SOAP WSDL files into Restorm collections
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  SoapRequest
} from '../../../shared/models'
import type { EnumDefinition } from '../../../shared/types/collections'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { wsdlToApiDocumentation } from './transformers/wsdlToApiDocumentation'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'

// ============================================================================
// WSDL Types
// ============================================================================

interface WsdlOperation {
  name: string
  documentation?: string | undefined
  soapAction: string
  input?: string | undefined
  output?: string | undefined
}

interface WsdlPortType {
  name: string
  operations: WsdlOperation[]
}

interface WsdlBinding {
  name: string
  portType: string
  operations: WsdlOperation[]
}

interface WsdlService {
  name: string
  documentation?: string | undefined
  ports: {
    name: string
    binding: string
    address: string
  }[]
}

interface ParsedWsdl {
  targetNamespace: string
  services: WsdlService[]
  portTypes: WsdlPortType[]
  bindings: WsdlBinding[]
}

// ============================================================================
// Parser Functions
// ============================================================================

/** Simple XML attribute parser */
function getAttr(element: string, attrName: string): string | undefined {
  const regex = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`)
  const match = element.match(regex)
  return match?.[1]
}

/** Extract content between tags */
function getContent(xml: string, tagName: string): string[] {
  const results: string[] = []
  const regex = new RegExp(`<(?:\\w+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tagName}>`, 'gi')
  let match
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[0])
  }
  return results
}

/** Parse a WSDL XML string */
function parseWsdl(wsdlContent: string): ParsedWsdl {
  const result: ParsedWsdl = {
    targetNamespace: '',
    services: [],
    portTypes: [],
    bindings: []
  }
  
  // Extract target namespace
  const nsMatch = /targetNamespace\s*=\s*["']([^"']+)["']/.exec(wsdlContent)
  if (nsMatch?.[1]) {
    result.targetNamespace = nsMatch[1]
  }
  
  // Parse services
  const serviceBlocks = getContent(wsdlContent, 'service')
  for (const serviceBlock of serviceBlocks) {
    const serviceName = getAttr(serviceBlock, 'name')
    if (!serviceName) continue
    
    const ports: WsdlService['ports'] = []
    const portMatches = serviceBlock.matchAll(/<(?:\w+:)?port[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?port>/gi)
    
    for (const portMatch of portMatches) {
      const portName = portMatch[1]
      const portContent = portMatch[2]
      
      if (!portName || !portContent) continue
      
      const bindingAttr = getAttr(portMatch[0], 'binding')
      const binding = bindingAttr?.split(':').pop() ?? ''
      
      const addressMatch = /location\s*=\s*["']([^"']+)["']/.exec(portContent)
      const address = addressMatch?.[1] ?? ''
      
      ports.push({ name: portName, binding, address })
    }
    
    // Extract documentation
    const docMatch = /<(?:\w+:)?documentation[^>]*>([\s\S]*?)<\/(?:\w+:)?documentation>/i.exec(serviceBlock)
    
    result.services.push({
      name: serviceName,
      documentation: docMatch?.[1]?.trim(),
      ports
    })
  }
  
  // Parse bindings
  const bindingBlocks = getContent(wsdlContent, 'binding')
  for (const bindingBlock of bindingBlocks) {
    const bindingName = getAttr(bindingBlock, 'name')
    const portType = getAttr(bindingBlock, 'type')?.split(':').pop() ?? ''
    if (!bindingName) continue
    
    const operations: WsdlOperation[] = []
    const opMatches = bindingBlock.matchAll(/<(?:\w+:)?operation[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?operation>/gi)
    
    for (const opMatch of opMatches) {
      const opName = opMatch[1]
      const opContent = opMatch[2]
      
      if (!opName || !opContent) continue
      
      const soapActionMatch = /soapAction\s*=\s*["']([^"']+)["']/.exec(opContent)
      
      operations.push({
        name: opName,
        soapAction: soapActionMatch?.[1] ?? ''
      })
    }
    
    result.bindings.push({
      name: bindingName,
      portType,
      operations
    })
  }
  
  // Parse port types
  const portTypeBlocks = getContent(wsdlContent, 'portType')
  for (const portTypeBlock of portTypeBlocks) {
    const portTypeName = getAttr(portTypeBlock, 'name')
    if (!portTypeName) continue
    
    const operations: WsdlOperation[] = []
    const opMatches = portTypeBlock.matchAll(/<(?:\w+:)?operation[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?operation>/gi)
    
    for (const opMatch of opMatches) {
      const opName = opMatch[1]
      const opContent = opMatch[2]
      
      if (!opName || !opContent) continue
      
      const docMatch = /<(?:\w+:)?documentation[^>]*>([\s\S]*?)<\/(?:\w+:)?documentation>/i.exec(opContent)
      
      operations.push({
        name: opName,
        soapAction: '',
        documentation: docMatch?.[1]?.trim()
      })
    }
    
    result.portTypes.push({
      name: portTypeName,
      operations
    })
  }
  
  return result
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Generate a deterministic ID from a seed string */
function generateId(seed?: string): string {
  if (!seed) {
    return crypto.randomUUID()
  }
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-${seed.length.toString(16).padStart(4, '0')}-4000-8000-${hex}${hex.slice(0, 4)}`
}

/** Build a sample SOAP envelope for an operation */
function buildSampleEnvelope(operation: WsdlOperation, namespace: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope 
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:tns="${namespace}">
  <soap:Header/>
  <soap:Body>
    <tns:${operation.name}Request>
      <!-- Add request parameters here -->
    </tns:${operation.name}Request>
  </soap:Body>
</soap:Envelope>`
}

/** Convert a WSDL operation to a SoapRequest */
function operationToRequest(
  service: WsdlService,
  operation: WsdlOperation,
  namespace: string,
  baseUrl: string,
  collectionName: string
): SoapRequest {
  return {
    type: 'soap',
    id: generateId(`${collectionName}:soap:${service.name}:${operation.name}`),
    name: operation.name,
    tags: ['soap'],
    url: baseUrl,
    soapAction: operation.soapAction,
    service: service.name,
    operation: operation.name,
    body: buildSampleEnvelope(operation, namespace),
    headers: [
      createTypedKeyValue({ key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true }),
      createTypedKeyValue({ key: 'SOAPAction', value: operation.soapAction, enabled: true })
    ]
  }
}

// ============================================================================
// Main Service
// ============================================================================

export interface SoapImportOptions {
  /** Base URL for SOAP endpoint */
  baseUrl?: string
  /** Name for the imported collection */
  name?: string
  /** Original URL the WSDL was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

/**
 * Import a WSDL file and convert it to a Folder structure
 */
export function importSoap(wsdlContent: string, options: SoapImportOptions = {}): EnvironmentFolder {
  const parsed = parseWsdl(wsdlContent)
  const name = options.name ?? parsed.services[0]?.name ?? 'SOAP API'
  
  // Create folders for each service
  const items: Folder['items'] = []
  
  for (const service of parsed.services) {
    // Find the binding and its operations
    const port = service.ports[0]
    const binding = parsed.bindings.find(b => b.name === port?.binding)
    const portType = parsed.portTypes.find(pt => pt.name === binding?.portType)
    
    if (!binding || !portType) continue
    
    // Merge operation info from binding and portType
    const operations = binding.operations.map(bindingOp => {
      return {
        ...bindingOp
      }
    })
    
    const baseUrl = options.baseUrl ?? port?.address ?? '{{baseUrl}}'
    
    const serviceFolder: Folder = {
      id: generateId(`${name}:folder:soap:${service.name}`),
      name: service.name,
      tags: ['service'],
      configuration: {},
      items: operations.map(op =>
        operationToRequest(service, op, parsed.targetNamespace, baseUrl, name)
      )
    }
    items.push(serviceFolder)
  }
  
  const environment: Environment = {
    id: generateId(`${name}:env:soap:Default`),
    name: 'Default',
    variables: [
      createTypedKeyValue({
        key: 'baseUrl',
        value: options.baseUrl ?? parsed.services[0]?.ports[0]?.address ?? 'http://localhost:8090',
        enabled: true
      })
    ]
  }
  
  const apiDocumentation = wsdlToApiDocumentation(parsed, {
    name,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})
  })

  // Extract XSD enum types: <simpleType name="X"><restriction><enumeration value="V"/></restriction></simpleType>
  const enumDefinitions: EnumDefinition[] = []
  const simpleTypeRegex = /<(?:\w+:)?simpleType[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?simpleType>/gi
  let stMatch
  while ((stMatch = simpleTypeRegex.exec(wsdlContent)) !== null) {
    const typeName = stMatch[1]
    const typeBody = stMatch[2]
    if (!typeName || !typeBody) continue
    const values: string[] = []
    const enumValRegex = /<(?:\w+:)?enumeration[^>]*value\s*=\s*["']([^"']+)["']/gi
    let evMatch
    while ((evMatch = enumValRegex.exec(typeBody)) !== null) {
      if (evMatch[1]) values.push(evMatch[1])
    }
    if (values.length > 0) {
      enumDefinitions.push({
        id: generateId(`enum:soap:${typeName}`),
        name: typeName,
        values,
        matchingRules: []
      })
    }
  }

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'wsdl',
    id: generateId(`${name}:folder:soap:root`),
    name,
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation,
    ...(enumDefinitions.length > 0 ? { enumDefinitions } : {})
  }

  return rootFolder
}

/**
 * Import a WSDL from a string
 */
export function importSoapFromString(content: string, options: SoapImportOptions = {}): EnvironmentFolder {
  return importSoap(content, options)
}
