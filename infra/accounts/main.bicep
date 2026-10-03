targetScope = 'resourceGroup'

// Draft infrastructure only. No pipeline deploys this template. Separate owner
// approval, credit/cost review, provider proof and role bootstrap are required.
@allowed(['dev', 'staging', 'prod'])
param environment string
param location string = resourceGroup().location
@minValue(1)
param monthlyBudget int
@minLength(1)
param budgetEmails array
@secure()
param migrationAdminPassword string
@secure()
param runtimePassword string
@description('Keep false for approved infrastructure bootstrap; deploy the app only after its image and runtime role exist.')
param deployApi bool = false
@description('Approved image SHA-256 digest (64 lowercase hex characters), required when deployApi is true.')
@maxLength(64)
param imageDigest string = ''
param cloudEnabled bool = false
param authority string = ''
param issuer string = ''
param externalTenantId string = ''
param apiAudience string = ''
param allowedClientIds array = []
param budgetStart string = '2026-10-01'

var suffix = uniqueString(resourceGroup().id)
var prefix = 'wisp-${environment}'
var databaseName = 'wisp_accounts_${environment}'
var tags = {
  application: 'WISP'
  environment: environment
  purpose: 'accounts'
  approval: 'separate-owner-approval-required'
}
var clientEnvironment = [
  for (client, index) in allowedClientIds: { name: 'Cloud__AllowedClientIds__${index}', value: client }
]

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.80.0.0/16'] }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: '10.80.0.0/27'
          delegations: [{ name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: '10.80.1.0/27'
          delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}
resource dns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${prefix}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}
resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: dns
  name: '${prefix}-link'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: network.id } }
}
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: '${prefix}-pg-${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    administratorLogin: 'wisp_migration_admin'
    administratorLoginPassword: migrationAdminPassword
    authConfig: { passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled' }
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: {
      delegatedSubnetResourceId: '${network.id}/subnets/postgres'
      privateDnsZoneArmResourceId: dns.id
      // Public access is absent for this VNet-integrated server; no firewall
      // rule exposes it to the Internet or to all Azure subscriptions.
    }
  }
  dependsOn: [dnsLink]
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-api-identity'
  location: location
  tags: tags
}
resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: 'wisp-${environment}-${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    accessPolicies: []
  }
}
resource connectionSecret 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: vault
  name: 'cloud-db-connection'
  properties: {
    value: 'Host=${postgres.properties.fullyQualifiedDomainName};Database=${databaseName};Username=wisp_runtime;Password="${replace(runtimePassword, '"', '""')}";SSL Mode=VerifyFull;Maximum Pool Size=20;Minimum Pool Size=0;Timeout=10;Command Timeout=15;Include Error Detail=false;Log Parameters=false'
  }
}
resource secretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: connectionSecret
  name: guid(connectionSecret.id, identity.id, 'secrets-user')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'wisp${environment}${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource imagePull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, identity.id, 'image-pull')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951ddb-4ed3-4680-a7ca-43fe172d538d'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: json('0.1') } }
}
resource hosting 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${prefix}-environment'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: { infrastructureSubnetId: '${network.id}/subnets/apps' }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}
resource api 'Microsoft.App/containerApps@2025-01-01' = if (deployApi) {
  name: '${prefix}-api'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: hosting.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, allowInsecure: false, targetPort: 8080, transport: 'http' }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [
        {
          name: 'database'
          keyVaultUrl: '${vault.properties.vaultUri}secrets/cloud-db-connection'
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registry.properties.loginServer}/wisp-cloud@sha256:${imageDigest}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat(
            [
              { name: 'ASPNETCORE_HTTP_PORTS', value: '8080' }
              { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
              { name: 'Cloud__Enabled', value: string(cloudEnabled) }
              { name: 'Cloud__Authority', value: authority }
              { name: 'Cloud__Issuer', value: issuer }
              {
                name: 'Cloud__TenantId'
                value: empty(externalTenantId) ? '00000000-0000-0000-0000-000000000000' : externalTenantId
              }
              {
                name: 'Cloud__ApiAudience'
                value: empty(apiAudience) ? '00000000-0000-0000-0000-000000000000' : apiAudience
              }
              { name: 'Cloud__ConnectionString', secretRef: 'database' }
            ],
            clientEnvironment
          )
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 8080 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 8080 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '10' } } }]
      }
    }
  }
  dependsOn: [secretAccess, imagePull, database]
}
resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: '${prefix}-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: { startDate: '${budgetStart}T00:00:00Z', endDate: '2030-01-01T00:00:00Z' }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: budgetEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: budgetEmails
      }
    }
  }
}
output apiHost string = deployApi ? api!.properties.configuration.ingress.fqdn : ''
output registryHost string = registry.properties.loginServer
