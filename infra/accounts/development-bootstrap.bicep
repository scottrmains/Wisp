targetScope = 'resourceGroup'

// Explicitly approved development operator only; never part of API startup.
@minLength(64)
@maxLength(64)
param imageDigest string
param approvalReference string
param location string = resourceGroup().location
var suffix = uniqueString(resourceGroup().id)
var tags = { application: 'WISP', environment: 'dev', purpose: 'accounts', approval: approvalReference }

resource hosting 'Microsoft.App/managedEnvironments@2025-01-01' existing = { name: 'wisp-dev-environment' }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: 'wispdev${suffix}' }
resource vault 'Microsoft.KeyVault/vaults@2024-11-01' existing = { name: 'wisp-dev-${suffix}' }
resource migrationSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' existing = { parent: vault, name: 'cloud-migration-connection' }
resource runtimeSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' existing = { parent: vault, name: 'cloud-runtime-password' }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'wisp-dev-migration-identity'
  location: location
  tags: tags
}
// Prerequisites: approved operator grants this identity AcrPull on this registry
// and Key Vault Secrets User on ONLY the two referenced secrets. This template
// does not create a second assignment over an existing grant or elevate itself.
resource job 'Microsoft.App/jobs@2025-01-01' = {
  name: 'wisp-dev-bootstrap'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: hosting.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [
        { name: 'migration', keyVaultUrl: '${vault.properties.vaultUri}secrets/${migrationSecret.name}', identity: identity.id }
        { name: 'runtime', keyVaultUrl: '${vault.properties.vaultUri}secrets/${runtimeSecret.name}', identity: identity.id }
      ]
    }
    template: {
      containers: [{
        name: 'bootstrap'
        image: '${registry.properties.loginServer}/wisp-cloud-migrations@sha256:${imageDigest}'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'WISP_CLOUD_MIGRATION_CONNECTION', secretRef: 'migration' }
          { name: 'WISP_CLOUD_RUNTIME_PASSWORD', secretRef: 'runtime' }
        ]
      }]
    }
  }
}
