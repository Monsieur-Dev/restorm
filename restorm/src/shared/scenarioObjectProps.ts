/**
 * Stable id for the default (not-yet-persisted) first property row shown on an
 * empty `object` node, mirroring the input node's default param row. Shared so
 * the validator can flag that exact row red when the object has no properties
 * yet — the same id the box renders it under.
 */
export const OBJECT_DEFAULT_PROPERTY_ID = 'object-default-property'
