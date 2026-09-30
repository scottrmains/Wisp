# Additive bootstrap. No deployment, domain changes, shared resources or secrets.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$subscription = 'fa9dfca3-f9c4-4859-a0c8-665c59380a3d'
$tenant = 'cc92b3bb-5fae-425c-b1a5-5aefea8ba6b1'
$group = 'rg-wisp-prod'
$siteName = 'wisp-web-prod'
$identityName = 'id-wisp-github-production'
$repository = 'scottrmains/Wisp'
function AzureJson([string[]]$Arguments) {
    $result = & az @Arguments --subscription $subscription --only-show-errors -o json
    if ($LASTEXITCODE -ne 0) { throw "Azure command failed: $($Arguments[0..1] -join ' ')" }
    $result | ConvertFrom-Json
}
$account = & az account show -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $account.id -ne $subscription -or $account.tenantId -ne $tenant) {
    throw 'Select the PulseLTV subscription in the expected tenant first. No resources changed.'
}
$null = AzureJson @('group', 'create', '--name', $group, '--location', 'uksouth', '--tags', 'application=WISP', 'environment=production')
$sites = @(AzureJson @('staticwebapp', 'list', '--resource-group', $group))
$site = $sites | Where-Object name -eq $siteName
if (-not $site) {
    # No repository source/token argument: do not let Azure generate another workflow.
    $site = AzureJson @('staticwebapp', 'create', '--name', $siteName, '--resource-group', $group, '--location', 'westeurope', '--sku', 'Free')
}
if ($site.sku.name -ne 'Free' -or $site.id -notlike "/subscriptions/$subscription/resourceGroups/$group/*") {
    throw 'Unexpected hosting resource/tier; refusing to change it.'
}
$identity = AzureJson @('identity', 'create', '--name', $identityName, '--resource-group', $group, '--location', 'uksouth')
$null = AzureJson @('identity', 'federated-credential', 'create', '--name', 'github-production', '--identity-name', $identityName, '--resource-group', $group,
    '--issuer', 'https://token.actions.githubusercontent.com', '--subject', "repo:${repository}:environment:production", '--audiences', 'api://AzureADTokenExchange')
# Contributor is scoped to this single site, not the group or subscription.
# Deployment needs Static Web Apps listSecrets/action; no identity can touch Pulse/Physiqo.
$assignments = @(AzureJson @('role', 'assignment', 'list', '--scope', $site.id))
if (-not ($assignments | Where-Object { $_.principalId -eq $identity.principalId -and $_.roleDefinitionId -like '*/b24988ac-6180-42a0-ab88-20f7382dd24c' })) {
    $null = AzureJson @('role', 'assignment', 'create', '--assignee-object-id', $identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Contributor', '--scope', $site.id)
}
$policy = '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
$null = $policy | & gh api "repos/$repository/environments/production" --method PUT --input -
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the production environment.' }
$policies = & gh api "repos/$repository/environments/production/deployment-branch-policies" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read production branch policies.' }
if (@($policies.branch_policies | Where-Object { $_.name -ne 'main' -or $_.type -ne 'branch' }).Count) {
    throw 'Unexpected existing deployment policies; review manually instead of deleting them.'
}
if (-not @($policies.branch_policies).Count) {
    $null = '{"name":"main","type":"branch"}' | & gh api "repos/$repository/environments/production/deployment-branch-policies" --method POST --input -
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict production deployments to main.' }
}
& gh variable set AZURE_CLIENT_ID --repo $repository --env production --body $identity.clientId
if ($LASTEXITCODE -ne 0) { throw 'Could not store public Azure identity ID.' }
& gh variable set WISP_SITE_URL --repo $repository --env production --body "https://$($site.defaultHostname)"
if ($LASTEXITCODE -ne 0) { throw 'Could not store public site URL.' }
Write-Host "WISP Free hosting prepared: https://$($site.defaultHostname)"
Write-Host 'Only main can federate into the WISP site deployment identity. No client secret or deployment token was stored in GitHub.'
