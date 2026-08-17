/**
 * The reference API design fixture — one design exercising EVERY field
 * of the entity family in `src/shared/types/apiDesign.ts`, so the
 * round-trip tests prove the whole shape survives persistence and the
 * seed helpers have one canonical rich design to plant in projects.
 *
 * IDs are fixed strings on purpose: the fixture must serialize to the
 * same bytes on every run (determinism assertions compare bytes).
 */

import type { ApiDesign } from '../../src/shared/types/apiDesign'

export function buildReferenceApiDesign(): ApiDesign {
  return {
    type: 'design',
    id: 'design-petstore',
    name: 'Petstore design',
    notes: 'Reference design used by the serialization tests.',
    tags: ['design', 'reference'],
    info: {
      title: 'Petstore',
      description: 'A pet store API designed in Restorm.',
      version: '1.0.0',
      contact: { name: 'API team', email: 'api@example.com', url: 'https://example.com/team' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      termsOfService: 'https://example.com/terms',
      externalDocs: { description: 'Wiki', url: 'https://example.com/wiki' }
    },
    server: { host: 'localhost', basePath: '/api', schemes: ['http'] },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT bearer' }
    },
    defaultSecurity: [{ bearerAuth: [] }],
    defaultAuth: 'bearer',
    serving: { protocols: ['http', 'graphql'], port: 7480 },
    models: [
      {
        id: 'model-user',
        doc: { name: 'User', description: 'A registered user.' },
        properties: [
          {
            id: 'prop-user-id',
            doc: { name: 'id', type: 'string', format: 'uuid', required: false, readOnly: true, description: 'Server-minted identifier.' },
            design: { immutable: true, unique: true }
          },
          {
            id: 'prop-user-email',
            doc: {
              name: 'email',
              type: 'string',
              format: 'email',
              required: true,
              description: 'Sign-in address.',
              example: 'ada@example.com',
              constraints: { maxLength: 254, pattern: '^[^@]+@[^@]+$' }
            },
            intents: { pii: true },
            design: { unique: true, searchable: true }
          },
          {
            id: 'prop-user-password',
            doc: { name: 'password', type: 'string', required: true, constraints: { minLength: 12 } },
            intents: { pii: true },
            design: { writeOnly: true }
          },
          {
            id: 'prop-user-status',
            doc: { name: 'status', type: 'string', required: false, nullable: true },
            design: { reference: { target: 'enum', refId: 'enum-status' }, defaultValue: 'active' }
          },
          {
            id: 'prop-user-nicknames',
            doc: { name: 'nicknames', type: 'array', required: false },
            design: { arrayItems: { type: 'string' } }
          },
          {
            id: 'prop-user-settings',
            doc: { name: 'settings', type: 'map', required: false, deprecated: true },
            design: { mapValues: { type: 'string' }, deprecationMessage: 'Use preferences instead.' }
          }
        ],
        examples: [
          {
            id: 'example-user-admin',
            name: 'an admin User',
            description: 'Full-rights account served by the design server.',
            values: { 'prop-user-email': 'admin@example.com', 'prop-user-status': 'active' }
          }
        ],
        intents: { volumetry: 'tenThousands' },
        design: {
          identifier: { propertyId: 'prop-user-id', strategy: 'uuid' },
          timestamps: true,
          softDelete: true
        },
        notes: 'Core account model.'
      },
      {
        id: 'model-admin',
        doc: { name: 'AdminUser', description: 'A user with elevated rights.' },
        properties: [
          {
            id: 'prop-admin-scope',
            doc: { name: 'scope', type: 'string', required: true }
          }
        ],
        design: { inheritsFrom: 'model-user' }
      },
      {
        id: 'model-order',
        doc: { name: 'Order' },
        properties: [
          {
            id: 'prop-order-id',
            doc: { name: 'id', type: 'integer', format: 'int64', required: false, readOnly: true }
          },
          {
            id: 'prop-order-customer',
            doc: { name: 'customer', type: 'User', required: true, targetModelRef: 'User' },
            design: { reference: { target: 'model', refId: 'model-user', onDelete: 'restrict' } }
          },
          {
            id: 'prop-order-items',
            doc: { name: 'lines', type: 'array', required: true, isArrayOfRef: true, targetModelRef: 'User' },
            design: { reference: { target: 'model', refId: 'model-user', onDelete: 'cascade' } }
          }
        ],
        intents: { volumetry: 'millions' },
        design: { identifier: { propertyId: 'prop-order-id', strategy: 'autoIncrement' }, timestamps: true }
      }
    ],
    enums: [
      {
        id: 'enum-status',
        doc: {
          name: 'UserStatus',
          description: 'Account lifecycle state.',
          properties: [],
          enumValues: ['active', 'suspended', 'deleted']
        }
      }
    ],
    routeGroups: [
      {
        id: 'group-users',
        doc: { name: 'Users', description: 'User management.', externalDocs: { url: 'https://example.com/users' } },
        design: {
          basePath: '/users',
          auth: 'bearer',
          headers: [{ name: 'X-Tenant', example: 'acme', description: 'Tenant discriminator.' }],
          versionPrefix: '/v1'
        },
        routes: [
          {
            id: 'route-user-get',
            doc: {
              match: { urlPattern: '/{{id}}', method: 'GET' },
              summary: 'Fetch one user',
              description: 'Returns the user carrying the given identifier.',
              operationId: 'getUser',
              parameters: [
                { name: 'id', location: 'path', type: 'string', required: true, description: 'The user id.' }
              ],
              responses: {
                '200': { description: 'The user.', schema: 'User' },
                '404': { description: 'No such user.' }
              }
            },
            intents: { traffic: 'high' },
            design: {
              paramLinks: { id: { modelId: 'model-user', propertyId: 'prop-user-id', descriptionAuto: true } },
              responses: { '200': { modelId: 'model-user', exampleId: 'example-user-admin' } },
              cacheSeconds: 60,
              idempotent: true
            },
            notes: 'Hot path — cache aggressively.'
          },
          {
            id: 'route-user-list',
            doc: {
              match: { urlPattern: '/', method: 'GET' },
              summary: 'List users',
              deprecated: true,
              responses: { '200': { description: 'A page of users.' } }
            },
            intents: { traffic: 'medium' },
            design: {
              responses: { '200': { modelId: 'model-user', list: true, paginated: true } },
              pagination: { style: 'offset', defaultLimit: 20, maxLimit: 100 }
            }
          },
          {
            id: 'route-user-create',
            doc: {
              match: { urlPattern: '/', method: 'POST' },
              summary: 'Create a user',
              responses: { '201': { description: 'Created.' } }
            },
            design: {
              body: { modelId: 'model-user', contentType: 'application/json' },
              responses: { '201': { modelId: 'model-user' } },
              authOverride: 'none'
            }
          }
        ]
      }
    ]
  }
}
