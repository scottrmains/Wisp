# WISP account development deployment evidence

Reviewed 2026-10-03. The owner approved proceeding with a development environment
conditional on using sponsorship credits. Production, paid identity add-ons,
desktop sign-in and repository merge/release decisions remain separate gates.
This is an operational evidence log, not a claim that Phase 2 is fully accepted.

## Sponsorship and cost scope

Read-only billing checks confirm the selected PulseLTV subscription uses the
sponsorship offer, has active startup credit and a GBP billing profile. Exact
balances, billing identifiers, account emails and private billing responses are
not published here. The reported balance is invoice-based, not live usage.
Spending limit is off; alerts are not a hard cap or assurance against later charges.

The planned infrastructure uses Microsoft's first-party Azure consumption
services, not Marketplace purchases, paid support or separate software licences.
This matches the published [sponsorship terms](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0036p/)
for ordinary Azure consumption; it is not a written Microsoft guarantee for all
future SKUs. Authentication uses the External ID base MAU tier, with no SMS,
premium or Go-Local add-on. Its core free allowance is separate from sponsorship
coverage; stay below that allowance and review billing before expanding usage.
See [External ID pricing](https://learn.microsoft.com/en-us/entra/external-id/external-identities-pricing).

Low-usage development planning estimate: approximately GBP 40–60/month before tax,
based on UK South retail rates and 730 compute hours/month, not a fixed quote:

| Component | Planning amount per month |
| --- | --- |
| B1ms PostgreSQL plus 32 GiB storage | Approximately GBP 13.65 |
| Basic container registry | Approximately GBP 3.82 |
| Managed standard load balancer and two standard IPs | Approximately GBP 19.35 before processed data |
| Private DNS zone | Approximately GBP 0.38 before queries |
| API compute, logs, secrets, build/operator jobs and egress | Variable; remaining allowance assumes light use |

No assumption that subscription-level free compute/log allowances remain unused
by other applications. Continuous active compute, retries, restore exercises or
additional managed-network rules can exceed this range. Use
[Azure retail prices](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
and the [managed-network billing rules](https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks#managed-resources)
when re-estimating actual deployment usage.

## Verified operational setup

- Created only the dedicated `rg-wisp-accounts-dev` group in UK South; no existing
  Pulse, Physiqo or WISP marketing resources were changed.
- Registered the required Container Apps and External ID resource providers.
- Created a development external tenant linked to the sponsorship subscription;
  the provider reports Succeeded and base A0/MAU billing, with no purchased add-ons.
- Created separate development API, native and website app registrations; exposed
  delegated `account.access`, requested v2 tokens and preauthorized only those
  clients. The sign-up/sign-in flow currently uses local email/password accounts.
- Created a GBP 60 monthly subscription-level budget filtered by all three tags:
  application WISP, environment dev and purpose accounts. Actual 80% and forecast
  100% notifications target the signed-in owner account. This includes tagged
  managed networking rather than monitoring only the primary resource group.
- Azure template validation and what-if succeeded. Changes were confined to the
  approved development group; existing identity resources were ignored/preserved.
- Created the dedicated RBAC Key Vault, with purge protection, and granted the
  deployment operator Secrets Officer only on that vault. Random administrator
  and runtime credentials are escrowed there before database creation and are
  never supplied through command-line arguments, files, source or logs.
- Infrastructure deployment is in progress. Live provisioning caught an incorrect
  AcrPull GUID; the template now uses the verified Azure role definition. Local
  compilation alone did not catch that identifier error.

## Deployment safeguards

The API identity reads only its runtime connection secret and pulls only from the
development registry. A separate bounded operator job will apply the migrations
and bootstrap the runtime role from private-network hosting. Its tool refuses
production database names, non-Azure hosts, insecure TLS, unbounded connections
and elevated runtime roles, and withholds exception/secret details from logs.
It is never called from the desktop or API startup path.

Cloud images must use a whitelisted Git build context containing only the cloud
projects and operator tool. Do not upload the whole working directory, audio,
ignored artifacts, local profiles or credential files. Container builds are
separate from the production Windows installer workflow.

## Remaining acceptance gates

- [ ] Infrastructure deployment, private DNS/connectivity and role assignments.
- [ ] Remote operator migration and reduced-role proof under actual Azure roles.
- [ ] Deployed liveness/readiness, unauthorized requests and safe logs.
- [ ] Real customer sign-up/sign-in and native browser redirect/token validation.
- [ ] Same customer identity/account from the native and actual website client.
- [ ] Real runtime-secret rotation, revision refresh and managed PostgreSQL restore.
- [ ] Signing-key refresh/rotation evidence and provider limitations review.
- [ ] Owner acceptance of Phase 2 before enabling desktop sign-in in Phase 3.

Current tenant creation, app registration and synthetic tests do not satisfy the
real sign-in, token, rotation or managed restore checks. Do not mark Phase 2 complete
or enable accounts in the desktop app based on provisioning progress alone.
