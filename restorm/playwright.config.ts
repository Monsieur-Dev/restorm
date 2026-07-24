import { defineConfig } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

// Define BDD configurations for each test group
const openFolderTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/open-folder/features/**/*.feature',
  steps: ['tests/e2e/bdd/open-folder/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-folder.fixture.ts'],
  outputDir: '.features-gen/open-folder'
})

const fullWorkflowTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/full-workflow/features/**/*.feature',
  steps: ['tests/e2e/bdd/full-workflow/steps/**/*.ts', 'tests/e2e/bdd/fixtures/full-workflow.fixture.ts'],
  outputDir: '.features-gen/full-workflow'
})

const swaggerImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/swagger-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/swagger-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/swagger-import.fixture.ts'],
  outputDir: '.features-gen/swagger-import'
})

const openapiImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/openapi-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/openapi-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/openapi-import.fixture.ts'],
  outputDir: '.features-gen/openapi-import'
})

const restClientImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/rest-client-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/rest-client-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/rest-client-import.fixture.ts'],
  outputDir: '.features-gen/rest-client-import'
})
const ramlImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/raml-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/raml-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/raml-import.fixture.ts'],
  outputDir: '.features-gen/raml-import'
})
const thriftImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/thrift-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/thrift-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/thrift-import.fixture.ts'],
  outputDir: '.features-gen/thrift-import'
})
const harImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/har-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/har-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/har-import.fixture.ts'],
  outputDir: '.features-gen/har-import'
})

const dirtyStateTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/dirty-state/features/**/*.feature',
  steps: ['tests/e2e/bdd/dirty-state/steps/**/*.ts', 'tests/e2e/bdd/fixtures/dirty-state.fixture.ts'],
  outputDir: '.features-gen/dirty-state'
})

const statusBarContextMenuTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/status-bar-context-menu/features/**/*.feature',
  steps: ['tests/e2e/bdd/status-bar-context-menu/steps/**/*.ts', 'tests/e2e/bdd/fixtures/dirty-state.fixture.ts'],
  outputDir: '.features-gen/status-bar-context-menu'
})

const odataPetstoreTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/odata-petstore/features/**/*.feature',
  steps: ['tests/e2e/bdd/odata-petstore/steps/**/*.ts', 'tests/e2e/bdd/fixtures/odata-petstore.fixture.ts'],
  outputDir: '.features-gen/odata-petstore'
})

const odataExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/odata-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/odata-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/odata-petstore.fixture.ts'],
  outputDir: '.features-gen/odata-execution'
})

const odataImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/odata-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/odata-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/odata-petstore.fixture.ts'],
  outputDir: '.features-gen/odata-import'
})

const smithyImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/smithy-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/smithy-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/smithy-import.fixture.ts'],
  outputDir: '.features-gen/smithy-import'
})
const wadlImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/wadl-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/wadl-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/wadl-import.fixture.ts'],
  outputDir: '.features-gen/wadl-import'
})
const apiBlueprintImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/api-blueprint-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/api-blueprint-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/api-blueprint-import.fixture.ts'],
  outputDir: '.features-gen/api-blueprint-import'
})

const authLoginTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/auth-login/features/**/*.feature',
  steps: ['tests/e2e/bdd/auth-login/steps/**/*.ts', 'tests/e2e/bdd/fixtures/auth-login.fixture.ts'],
  outputDir: '.features-gen/auth-login'
})

const mcpServerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/mcp-server/features/**/*.feature',
  steps: ['tests/e2e/bdd/mcp-server/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/mcp-server'
})

const socketioExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/socketio-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/socketio-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/socketio-execution'
})

const websocketExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/websocket-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/websocket-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/websocket-execution'
})

const grpcExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/grpc-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/grpc-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/grpc-execution'
})

const graphqlOperationNameTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/graphql-operation-name/features/**/*.feature',
  steps: ['tests/e2e/bdd/graphql-operation-name/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/graphql-operation-name'
})

const soapExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/soap-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/soap-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/soap-execution'
})

const jsonrpcExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/jsonrpc-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/jsonrpc-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/jsonrpc-execution'
})

const mqttExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/mqtt-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/mqtt-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/mqtt-execution'
})

const sseExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/sse-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/sse-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/sse-execution'
})

const amqpExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/amqp-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/amqp-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/amqp-execution'
})

const stompExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/stomp-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/stomp-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/stomp-execution'
})

const redisExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/redis-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/redis-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/redis-execution'
})

const kafkaExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/kafka-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/kafka-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/kafka-execution'
})

const quickSettingsTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/quick-settings/features/**/*.feature',
  steps: ['tests/e2e/bdd/quick-settings/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/quick-settings'
})

const scenarioQuickConfigSelectorTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/scenario-quick-config-selector/features/**/*.feature',
  steps: ['tests/e2e/bdd/scenario-quick-config-selector/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/scenario-quick-config-selector'
})

const grpcServerExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/grpc-server/features/**/*.feature',
  steps: ['tests/e2e/bdd/grpc-server/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/grpc-server'
})

const httpServerExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/http-server/features/**/*.feature',
  steps: ['tests/e2e/bdd/http-server/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/http-server'
})

const soapServerExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/soap-server/features/**/*.feature',
  steps: ['tests/e2e/bdd/soap-server/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/soap-server'
})

const graphqlServerExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/graphql-server/features/**/*.feature',
  steps: ['tests/e2e/bdd/graphql-server/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/graphql-server'
})

const odataServerExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/odata-server/features/**/*.feature',
  steps: ['tests/e2e/bdd/odata-server/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/odata-server'
})

const httpExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/http-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/http-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/http-execution'
})

const graphqlExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/graphql-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/graphql-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/graphql-execution'
})

const trpcExecutionTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/trpc-execution/features/**/*.feature',
  steps: ['tests/e2e/bdd/trpc-execution/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/trpc-execution'
})

const fullyDocumentedPetstoreTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/fully-documented-petstore/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/fully-documented-petstore/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/fully-documented-petstore.fixture.ts'
  ],
  outputDir: '.features-gen/fully-documented-petstore'
})

const documentationViewerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/documentation-viewer/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/documentation-viewer/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/documentation-viewer.fixture.ts'
  ],
  outputDir: '.features-gen/documentation-viewer'
})

const exhaustiveDocViewerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/exhaustive-doc-viewer/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/exhaustive-doc-viewer/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/exhaustive-doc-viewer.fixture.ts'
  ],
  outputDir: '.features-gen/exhaustive-doc-viewer'
})

const scenarioSuggestionsTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/scenario-suggestions/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/scenario-suggestions/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/scenario-suggestions.fixture.ts'
  ],
  outputDir: '.features-gen/scenario-suggestions'
})

const scenarioRunlogTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/scenario-runlog/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/scenario-runlog/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/scenario-runlog.fixture.ts'
  ],
  outputDir: '.features-gen/scenario-runlog'
})

const scenarioCodeDepsTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/scenario-code-deps/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/scenario-code-deps/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/scenario-code-deps.fixture.ts'
  ],
  outputDir: '.features-gen/scenario-code-deps'
})

const scenarioCodeDepsRealTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/scenario-code-deps-real/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/scenario-code-deps-real/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/scenario-code-deps-real.fixture.ts'
  ],
  outputDir: '.features-gen/scenario-code-deps-real'
})

const scenarioSetVariableOverrideTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/scenario-setvariable-override/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/scenario-setvariable-override/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/scenario-runlog.fixture.ts'
  ],
  outputDir: '.features-gen/scenario-setvariable-override'
})

const postmanImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/postman-import/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/postman-import/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/postman-import.fixture.ts'
  ],
  outputDir: '.features-gen/postman-import'
})

const thunderClientImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/thunder-client-import/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/thunder-client-import/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/thunder-client-import.fixture.ts'
  ],
  outputDir: '.features-gen/thunder-client-import'
})

const secretsSourcesTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/secrets-sources/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/secrets-sources/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/secrets-sources.fixture.ts'
  ],
  outputDir: '.features-gen/secrets-sources'
})

const settingsTabTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/settings-tab/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/settings-tab/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/settings-tab.fixture.ts'
  ],
  outputDir: '.features-gen/settings-tab'
})

const themeCarouselA11yTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/theme-carousel-a11y/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/theme-carousel-a11y/steps/**/*.ts',
    // Reuses the "no file is open" / "open Settings from the gear button"
    // steps already registered for the settings-tab suite.
    'tests/e2e/bdd/settings-tab/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/settings-tab.fixture.ts'
  ],
  outputDir: '.features-gen/theme-carousel-a11y'
})

const mcpLogsTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/mcp-logs/features/mcp-logs.feature',
  steps: [
    'tests/e2e/bdd/mcp-logs/steps/mcp-logs.steps.ts',
    'tests/e2e/bdd/fixtures/mcp-logs.fixture.ts'
  ],
  outputDir: '.features-gen/mcp-logs'
})

const mcpLogsDisabledTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/mcp-logs/features/mcp-logs-disabled.feature',
  steps: [
    'tests/e2e/bdd/mcp-logs/steps/mcp-logs-disabled.steps.ts',
    'tests/e2e/bdd/fixtures/mcp-logs-disabled.fixture.ts'
  ],
  outputDir: '.features-gen/mcp-logs-disabled'
})

const bodyTypeMigrationTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/body-type-migration/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/body-type-migration/steps/**/*.ts',
    'tests/e2e/bdd/body-type-migration/fixtures/body-type-migration.fixture.ts'
  ],
  outputDir: '.features-gen/body-type-migration'
})

const pawImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/paw-import/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/paw-import/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/paw-import.fixture.ts'
  ],
  outputDir: '.features-gen/paw-import'
})

const sidebarSplitDropTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/sidebar-split-drop/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/sidebar-split-drop/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/sidebar-split-drop.fixture.ts'
  ],
  outputDir: '.features-gen/sidebar-split-drop'
})

const httpieImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/httpie-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/httpie-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/httpie-import.fixture.ts'],
  outputDir: '.features-gen/httpie-import'
})
const typespecImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/typespec-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/typespec-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/typespec-import.fixture.ts'],
  outputDir: '.features-gen/typespec-import'
})

const gitStatusTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/git-status/features/**/*.feature',
  steps: ['tests/e2e/bdd/git-status/steps/**/*.ts', 'tests/e2e/bdd/fixtures/git-integration.fixture.ts'],
  outputDir: '.features-gen/git-status'
})

const gitPushPullTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/git-push-pull/features/**/*.feature',
  steps: ['tests/e2e/bdd/git-push-pull/steps/**/*.ts', 'tests/e2e/bdd/fixtures/git-integration.fixture.ts'],
  outputDir: '.features-gen/git-push-pull'
})

const gitConflictTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/git-conflict/features/**/*.feature',
  steps: ['tests/e2e/bdd/git-conflict/steps/**/*.ts', 'tests/e2e/bdd/fixtures/git-integration.fixture.ts'],
  outputDir: '.features-gen/git-conflict'
})

const gitCollabTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/git-collab/features/**/*.feature',
  steps: ['tests/e2e/bdd/git-collab/steps/**/*.ts', 'tests/e2e/bdd/fixtures/git-collab.fixture.ts'],
  outputDir: '.features-gen/git-collab'
})

const gitMcpTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/git-mcp/features/**/*.feature',
  steps: ['tests/e2e/bdd/git-mcp/steps/**/*.ts', 'tests/e2e/bdd/fixtures/git-mcp.fixture.ts'],
  outputDir: '.features-gen/git-mcp'
})

/**
 * Playwright configuration for Electron E2E tests using playwright-bdd.
 * Each test group has its own project with a dedicated fixture.
 */
export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  /* Timeouts */
  timeout: 120 * 1000,
  expect: {
    timeout: 10000
  },

  /* Run tests in files in parallel */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retries: enabled automatically at ship/push time (RESTORM_SHIP=1, set by
   * the pre-push hook) and on CI (CI=1). Plain `pnpm test:e2e` in dev gets
   * retries:0 so raw failure output is immediately visible.
   * Retries only self-heal genuine flakes (fail-then-pass); a consistently
   * broken test still fails every attempt and blocks the push. */
  retries: (process.env.RESTORM_SHIP || process.env.CI) ? 2 : 0,

  /* Electron projects run across workers (each project/file stays serial
   * internally — `fullyParallel: false`), so the long-pole projects (scenario
   * run-log, full-workflow) overlap instead of summing.
   *
   * Capped at 2 workers: each Electron worker is a full Chromium instance
   * (~300-500 MB), so 4 in parallel — on top of the build, a running restorm
   * and a browser — exhausts physical RAM on a 16 GB host and pushes it into
   * heavy swap. Swap thrashing intermittently starves renderer timers, which
   * surfaces as flaky `waitFor`/`toBeVisible` timeouts on menu/submenu
   * rendering (the failure mode was NOT CPU-bound — load stayed ~11%). Two
   * workers keep the peak resident set within physical RAM; a full run is
   * slower than at 4 but stable. CI runners with dedicated RAM can raise this.
   *
   * Dropped to 1 (serial) on this RAM-constrained no-swap host: even 2 workers
   * intermittently thrashed and starved renderer timers, surfacing as flaky
   * `waitFor` timeouts on the MCP-driven "open the request tab via MCP" steps
   * (kafka/jsonrpc lost the lottery on different pushes). Serial is ~2x slower
   * but deterministic — no cross-worker MCP contention. Raise again (or make
   * env-conditional for CI) once the host has more RAM. */
  workers: 1,

  /* Reporter */
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }]
  ],

  /* Capture trace + screenshot only on failure so the per-test
   * artefacts dir holds enough context to debug a flake without
   * re-running. Required for the `Read` tool to actually open the
   * end-state screenshot the CLAUDE.md debugging note assumes. */
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  /* Projects for each test group */
  projects: [
    {
      name: 'open-folder',
      testDir: openFolderTestDir
    },
    {
      name: 'full-workflow',
      testDir: fullWorkflowTestDir,
      timeout: 300 * 1000 // 5 min — cumulative scenario covers the full Ajouter submenu and runs near 3 min on slower hosts
    },
    {
      name: 'swagger-import',
      testDir: swaggerImportTestDir
    },
    {
      name: 'openapi-import',
      testDir: openapiImportTestDir
    },
    {
      name: 'rest-client-import',
      testDir: restClientImportTestDir
    },
    {
      name: 'raml-import',
      testDir: ramlImportTestDir
    },
    {
      name: 'thrift-import',
      testDir: thriftImportTestDir
    },
    {
      name: 'har-import',
      testDir: harImportTestDir
    },
    {
      name: 'dirty-state',
      testDir: dirtyStateTestDir
    },
    {
      name: 'status-bar-context-menu',
      testDir: statusBarContextMenuTestDir
    },
    {
      name: 'odata-petstore',
      testDir: odataPetstoreTestDir
    },
    {
      name: 'odata-execution',
      testDir: odataExecutionTestDir
    },
    {
      name: 'odata-import',
      testDir: odataImportTestDir
    },
    {
      name: 'smithy-import',
      testDir: smithyImportTestDir
    },
    {
      name: 'wadl-import',
      testDir: wadlImportTestDir
    },
    {
      name: 'api-blueprint-import',
      testDir: apiBlueprintImportTestDir
    },
    {
      name: 'typespec-import',
      testDir: typespecImportTestDir
    },
    {
      name: 'auth-login',
      testDir: authLoginTestDir
    },
    {
      name: 'mcp-server',
      testDir: mcpServerTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'socketio-execution',
      testDir: socketioExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'websocket-execution',
      testDir: websocketExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'grpc-execution',
      testDir: grpcExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'graphql-operation-name',
      testDir: graphqlOperationNameTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'soap-execution',
      testDir: soapExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'jsonrpc-execution',
      testDir: jsonrpcExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'mqtt-execution',
      testDir: mqttExecutionTestDir,
      timeout: 180 * 1000
    },
    // STOMP is client-only (no restorm-hosted broker mode), so this suite
    // depends on the docker `rmohr/activemq` mock being up — unlike
    // WebSocket/Socket.IO/MQTT, which self-host. Opt out with
    // SKIP_STOMP_E2E=1 when the broker isn't available (e.g. a host without
    // docker), mirroring the `stage-gating` opt-IN pattern below but inverted.
    ...(process.env.SKIP_STOMP_E2E === '1'
      ? []
      : [
          {
            name: 'stomp-execution',
            testDir: stompExecutionTestDir,
            timeout: 180 * 1000
          }
        ]),
    {
      name: 'sse-execution',
      testDir: sseExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'amqp-execution',
      testDir: amqpExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'redis-execution',
      testDir: redisExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'kafka-execution',
      testDir: kafkaExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'quick-settings',
      testDir: quickSettingsTestDir,
      timeout: 300 * 1000 // 5 min — 8 scenarios, each launches a fresh app
    },
    {
      name: 'scenario-quick-config-selector',
      testDir: scenarioQuickConfigSelectorTestDir,
      timeout: 240 * 1000
    },
    {
      name: 'grpc-server',
      testDir: grpcServerExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'http-server',
      testDir: httpServerExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'soap-server',
      testDir: soapServerExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'graphql-server',
      testDir: graphqlServerExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'odata-server',
      testDir: odataServerExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'http-execution',
      testDir: httpExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'graphql-execution',
      testDir: graphqlExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'trpc-execution',
      testDir: trpcExecutionTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'fully-documented-petstore',
      testDir: fullyDocumentedPetstoreTestDir
    },
    {
      name: 'documentation-viewer',
      testDir: documentationViewerTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'exhaustive-doc-viewer',
      testDir: exhaustiveDocViewerTestDir,
      timeout: 300 * 1000  // 5 min — many scenarios, each opens a fresh app
    },
    {
      name: 'scenario-suggestions',
      testDir: scenarioSuggestionsTestDir
    },
    {
      name: 'scenario-runlog',
      testDir: scenarioRunlogTestDir,
      timeout: 180 * 1000 // 3 min — three scenarios, each opens a fresh app + runs the engine
    },
    {
      name: 'scenario-code-deps',
      testDir: scenarioCodeDepsTestDir,
      timeout: 420 * 1000 // 7 min — one app; the offline chain installs + mounts a package in all five WASM runtimes (cold Pyodide + WebR + ruby.wasm + wasmoon + QuickJS), and the cache-reuse scenario runs it twice
    },
    {
      name: 'scenario-setvariable-override',
      testDir: scenarioSetVariableOverrideTestDir,
      timeout: 120 * 1000 // 2 min — opens a fresh app + runs one scenario against the petstore mock
    },
    {
      name: 'postman-import',
      testDir: postmanImportTestDir,
      timeout: 180 * 1000 // 3 min — opens a fresh app, imports + runs the workflow against docker
    },
    {
      name: 'thunder-client-import',
      testDir: thunderClientImportTestDir
    },
    {
      name: 'secrets-sources',
      testDir: secretsSourcesTestDir,
      timeout: 120 * 1000 // opens a fresh app, runs one secret-bearing request against docker
    },
    {
      name: 'settings-tab',
      testDir: settingsTabTestDir,
      timeout: 120 * 1000
    },
    {
      name: 'theme-carousel-a11y',
      testDir: themeCarouselA11yTestDir,
      timeout: 120 * 1000
    },
    {
      name: 'mcp-logs',
      testDir: mcpLogsTestDir,
      timeout: 120 * 1000 // MCP on by default; opens the viewer as tab + modal
    },
    {
      name: 'mcp-logs-disabled',
      testDir: mcpLogsDisabledTestDir,
      timeout: 120 * 1000 // pre-seeds mcp:enabled=false (no --no-mcp flag); asserts the menu entry is disabled
    },
    {
      name: 'body-type-migration',
      testDir: bodyTypeMigrationTestDir,
      timeout: 120 * 1000 // opens a fresh app + a legacy-spelling .restorm file
    },
    {
      name: 'sidebar-split-drop',
      testDir: sidebarSplitDropTestDir,
      timeout: 120 * 1000 // opens the reference project; drags sidebar items onto tabs / a scenario
    },
    // The git suites depend on the docker `git-server` mock (a real git://
    // remote) — unlike every self-hosted protocol above, there is no
    // restorm-hosted alternative. Opt out with SKIP_GIT_E2E=1 on a host that
    // can't run docker, mirroring the `stomp-execution` / activemq pattern.
    ...(process.env.SKIP_GIT_E2E === '1'
      ? []
      : [
          {
            name: 'git-status',
            testDir: gitStatusTestDir,
            timeout: 120 * 1000
          },
          {
            name: 'git-push-pull',
            testDir: gitPushPullTestDir,
            timeout: 120 * 1000
          },
          {
            name: 'git-conflict',
            testDir: gitConflictTestDir,
            timeout: 180 * 1000 // multiple diverging clones per scenario + the 4-panel resolution UI
          },
          {
            name: 'git-mcp',
            testDir: gitMcpTestDir,
            timeout: 120 * 1000
          },
          {
            name: 'git-collab',
            testDir: gitCollabTestDir,
            // ONE long multi-chapter scenario driving TWO live instances.
            timeout: 600 * 1000
          }
        ]),
    {
      name: 'paw-import',
      testDir: pawImportTestDir,
      timeout: 180 * 1000 // opens a fresh app, imports the Paw JSON fixture, runs one request against the live docker petstore
    },
    {
      name: 'httpie-import',
      testDir: httpieImportTestDir,
      timeout: 120 * 1000 // opens a fresh app, imports both HTTPie shapes, runs one request against docker
    },
    {
      // Headless CLI runner — a plain spec (no BDD/UI) that spawns the built app
      // with `--run` and asserts stdout + exit code.
      name: 'scenario-cli',
      testDir: 'tests/e2e/scenario-cli',
      timeout: 180 * 1000
    },
    // Real-registry code-deps e2e. It installs pinned packages from the LIVE
    // registries (PyPI / npm / WebR-CRAN / RubyGems / LuaRocks), so it needs
    // network + is non-deterministic — it must NEVER run in the per-PR / pre-push
    // suite. Included ONLY when RESTORM_E2E_REAL_DEPS=1, so a plain `pnpm
    // test:e2e` (and the pre-push hook) never even sees the project. Run it
    // deliberately as a nightly / release guard:
    //   RESTORM_E2E_REAL_DEPS=1 xvfb-run -a pnpm exec playwright test --project code-deps-real-registry
    ...(process.env.RESTORM_E2E_REAL_DEPS === '1'
      ? [
          {
            name: 'code-deps-real-registry',
            testDir: scenarioCodeDepsRealTestDir,
            timeout: 360 * 1000 // one app, two live-install runs across five cold WASM runtimes
          }
        ]
      : []),
    // Stage-only entitlement-gating lifecycle e2e. It hits REAL external deps
    // (dev WorkOS + dev Supabase) with a live login, so it must NEVER run in the
    // per-PR / pre-push suite. It is included ONLY when RESTORM_E2E_STAGE=1, so a
    // plain `pnpm test:e2e` (and the pre-push hook) never even sees the project.
    // Run it deliberately as a non-regression guard:
    //   RESTORM_E2E_STAGE=1 xvfb-run -a pnpm exec playwright test --project stage-gating
    ...(process.env.RESTORM_E2E_STAGE === '1'
      ? [
          {
            name: 'stage-gating',
            testDir: 'tests/e2e/stage-gating',
            timeout: 300 * 1000 // a real WorkOS login round-trip + entitlement fetch
          }
        ]
      : [])
  ]
})
