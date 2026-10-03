# WISP cloud account service and development runbook

Phase 2 code and templates are implemented for review. On 2026-10-03 the owner
subsequently approved a dedicated development deployment conditional on sponsorship
coverage, following the initial code-only slice. That supersedes the initial
no-provisioning decision for development only. Cost/credit checks, deployment
progress and pending live acceptance tests are recorded in
[development deployment evidence](accounts-development-deployment.md).
Production provisioning, paid identity add-ons and desktop sign-in remain
unapproved. Phase 2 is not fully accepted yet.

## Service boundaries

`Wisp.Cloud.slnx` contains an independent ASP.NET Core API and PostgreSQL
persistence project with its own migration history and tests. Neither depends
on the desktop API, SQLite, native bridge, Soulseek credentials, music files or
recording folders. The desktop solution and installer pipeline do not build or
package the cloud service. WISP still starts and works as Guest.

No community, media upload, local-library sync, premium checks or billing is
implemented. No cloud project is added to the desktop startup path. The API uses
the maintained ASP.NET JWT middleware and Npgsql EF provider, not a home-built
signature validator or the desktop's non-secret local command marker.

## API contract and identity validation

| Route | Authentication and response |
| --- | --- |
| `GET /health/live` | Anonymous process liveness; does not prove database/provider readiness |
| `GET /health/ready` | 503 when disabled, unavailable or unmigrated; reads a migrated table when enabled |
| `GET /api/v1/account/me` | Valid delegated access token and `account.access` scope; version-1 private account view, or 404 before provisioning |
| `POST /api/v1/account/provision` | Same policy; empty body only, returns the same version-1 account across retries |

Account views include `contractVersion`, `userId`, `displayName` and `state`.
They exclude email, provider identifiers, tokens, local paths, secrets and billing
details. No endpoint accepts a user ID to select someone else's private account.
Query-string IDs cannot change ownership; foreign-ID routes do not exist.

When enabled, configuration pins an exact trusted issuer, API audience, tenant,
allowed native/website client IDs and delegated scope. Validation checks RSA
signatures, RS256 algorithm, expiration/not-before, a 30-second clock tolerance,
token version 2, tenant/object IDs and authorized client. Duplicate identity
claims, application-only permissions and ID tokens without the API scope fail.
HTTPS discovery is mandatory and bounded. Keys refresh through the middleware's
provider metadata mechanism; key rotation has not been exercised against Entra.
The strict issuer validator does not widen trust to an unexpected metadata issuer.

Cloud identity is `(validated issuer, tenant ID, object ID)`, never an email,
display name or client-submitted ID. The real provider proof must verify these
claims are present and stable across native and website API tokens. Client-pairwise
subjects are deliberately not used to split the same tenant/object into two users.
See Microsoft's [claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
and [protected API quickstart](https://learn.microsoft.com/en-ie/entra/identity-platform/quickstart-web-api-dotnet-protect-app?tabs=aspnet-core).

## PostgreSQL and account lifecycle

The initial migration creates users, private profiles, trusted auth identities and
account audit records. No provider email or token is stored. User IDs are random,
server-generated UUIDs. The default private display name is DJ; public profiles
and editing/registration UX belong to later phases.

Provisioning runs in a transaction, takes a PostgreSQL advisory lock derived from
the complete trusted identity, then creates the user, profile, identity and audit
atomically. A composite primary key also enforces identity uniqueness. Colliding
lock hashes can delay unrelated callers but cannot merge identities. Retrying or
simultaneously provisioning returns one account and one creation audit.

Active users are allowed; Disabled, Deleting and Deleted users receive a generic
403 even with valid provider tokens. Identity tombstones remain so another callback
does not resurrect a deleted account. An internal lifecycle primitive supports
conditional, audited transitions, including terminal deletion. It has **no public
admin/delete endpoint** and does not erase provider identities or user content.
Phase 4 must authorize actors, define retention/erasure and coordinate provider
deletion before exposing it to customers or operators.

## Configuration and operating limits

Default `Cloud:Enabled` is false. Disabled mode needs no PostgreSQL or Entra
connection and rejects private requests. Configuration is supplied through
deployment settings or secret references, never a committed personal config.

| Environment setting | Required meaning when enabled |
| --- | --- |
| `Cloud__Enabled` | Explicit true; validation-only artifacts never activate it |
| `Cloud__Authority` | Approved Microsoft HTTPS discovery authority for this external tenant |
| `Cloud__Issuer` | Exact issuer verified from that tenant's metadata, with its tenant ID and `/v2.0` path |
| `Cloud__TenantId` | Development external tenant UUID, not the workforce subscription tenant by assumption |
| `Cloud__ApiAudience` | API application UUID for v2 access tokens |
| `Cloud__AllowedClientIds__0`, `__1` | Approved native and website registrations; not all applications in the tenant |
| `Cloud__ConnectionString` | Secret reference for the separate account PostgreSQL database |

The production runtime username must be `wisp_runtime`, with TLS VerifyFull,
pooling enabled, maximum pool size at most 20, connection timeout 1–15 seconds,
command timeout 1–30 seconds and no parameter/error-detail logging. Example
structure without a password: `Host=<private-pg-host>;Database=wisp_accounts_dev;Username=wisp_runtime;SSL Mode=VerifyFull;Maximum Pool Size=20;Timeout=10;Command Timeout=15`.
Actual password values belong only in protected deployment secrets.

HTTP requests have a 20-second cancellation deadline, 16-KiB Kestrel body limit,
10-second header timeout and at most 100 concurrent connections. Provisioning
rejects nonempty bodies. Fixed global rate-limit partitions bound memory: 120 API
requests/minute/replica and a separate health allowance. A 429 includes Retry-After.
This conservative development limit is not distributed, per-user throttling or
DDoS protection. Template scaling is capped at one replica pending a reviewed
capacity plan. Do not blindly increase replicas and multiply database pools.

Responses use no-store, nosniff and a new server-generated request ID; caller IDs
are not echoed. Logs contain only safe request IDs/status and generic failure
events. Framework/EF/Npgsql request/parameter/exception logs are suppressed so
bearer tokens, query strings and database secrets do not leak through defaults.
Exceptions return generic service/account codes, not SQL or claim details.

## Local verification

Run cloud tests using a new isolated loopback PostgreSQL cluster, reusing only the
installed binaries, not an existing service or database:

```powershell
./tools/test-cloud-postgres.ps1 -PostgresBin 'C:/Program Files/PostgreSQL/17/bin'
```

The runner refuses an occupied test port, creates an owned artifact directory,
starts PostgreSQL at 127.0.0.1:19594, creates only `wisp_cloud_test`, runs tests and
stops that owned cluster in finally. It does not stop the system PostgreSQL
service. Local trust authentication applies only to this temporary synthetic
cluster and must never be copied into deployment settings. Artifacts are ignored.

CI runs the separate solution with a synthetic PostgreSQL 17 container and no
Azure login. Missing/non-loopback/non-test database configuration fails rather
than quietly skipping integration tests. Each fixture creates a fresh test schema
and never clears an existing database. Synthetic RSA keys replace discovery only
through test dependency injection; the production host has no authentication
bypass or development-token switch.

Verified locally: 28 tests pass, covering invalid/unsigned/expired/wrong-algorithm/
wrong-issuer/audience/tenant/client tokens, scope and anonymous failures, sixteen
parallel sign-ins, changed email and native/web subjects, private-record isolation,
restricted/terminal states, redacted logs, rate limits and production configuration.
A restricted synthetic runtime role can provision/read and pass readiness, but
cannot update account state, delete users or create tables in the account schema.
An intentionally failing **EF migration** rolls back DDL/history while preserving
an account. A separate empty fixture downgrades/reapplies the initial migration.
Real `pg_dump`/`pg_restore` into a new owned database preserves account IDs,
profiles, identities and creation audit counts. This is a local recovery proof,
not a tested Azure point-in-time restore or a production recovery guarantee.

## Draft Azure deployment scope

`infra/accounts/main.bicep` compiles locally without errors. It is a draft, not a
validated or deployed Azure environment. It creates resources only in the selected
WISP account resource group with explicit dev/staging/prod names and separate
database/configuration. Use dedicated groups such as `rg-wisp-accounts-dev`; do not
modify Pulse, Physiqo or the existing WISP marketing group. Proposed UK South
requires regional availability and quota review before deployment.

The template proposes a VNet-integrated PostgreSQL 17 B1ms server/32-GiB storage,
private database DNS, separate runtime secret in RBAC Key Vault, a dedicated managed
identity, Basic ACR with admin credentials off, consumption Container Apps with
HTTPS ingress, redacted Log Analytics with an ingestion cap, health probes and a
resource-group monthly budget with actual/forecast email alerts. Managed identity
has only secret-read and registry-pull roles at the specific resource scopes;
database access uses a separately bootstrapped restricted role. Entra registration
and customer flows are not created by this template.

The template defaults to `deployApi=false`: approved infrastructure bootstrap
creates no Container App and requires no image. After publishing an approved image
to that registry and bootstrapping the runtime database role, redeploy with
`deployApi=true` and its 64-character SHA-256 image digest. The cloud service itself
also defaults to disabled. Secret parameters, alert contacts and budget are
required inputs even for bootstrap. No pipeline builds,
pushes or deploys images. The Dockerfile is a future deployment template only;
no cloud image or desktop installer was built during verification. A registry must
exist and contain the approved image before deploying the app. The bootstrap
switch separates that step from app deployment; neither step has been run or
approved, and disabled readiness intentionally returns 503.

Pending deployment checks include Azure what-if/policy validation, resource
provider registration, Key Vault reference/RBAC propagation, private networking,
role/bootstrap commands, image readiness, regional B1ms quotas and real resource
costs. Secrets must be passed as secure parameters or managed references, never
saved into Git, shown on a command line or emitted as template outputs. Review
[Container Apps managed identities](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull)
and [PostgreSQL resource configuration](https://learn.microsoft.com/en-us/azure/templates/microsoft.dbforpostgresql/2025-08-01/flexibleservers)
before approving actual deployment.

## Development deployment and recovery checklist

1. Confirm credit eligibility for each service, subscription offer, region, budget
   currency, alerts, compute/storage/backup/logging/registry/network/egress estimates
   and supported quotas. Subscription access is not credit confirmation. Alerts
   and ingestion caps are not an overall spending cap. No resource is approved yet.
2. Approve only the dedicated development scope. Create a customer External ID
   tenant and API/native/web registrations with delegated `account.access`. Verify
   sign-up/sign-in, access-token issuer/audience/claims/client IDs, native system-
   browser PKCE redirect and the same user mapping from both clients. Do not use
   production users, capture real tokens in artifacts or treat the current RSA
   fixtures as an Entra proof. Review [External ID limits](https://learn.microsoft.com/en-us/entra/external-id/customers/troubleshooting-known-issues).
3. Review/bootstrap the isolated infrastructure, registry image, network and secrets.
   Use a deployment identity limited to the approved group, with separate ability
   to assign the specific roles. Do not give the runtime a migration/admin identity.
4. From an authorized private-network migration host, create `wisp_runtime` with
   LOGIN but no superuser, createdb or createrole privileges; revoke unwanted public
   schema privileges and grant only CONNECT/USAGE and required SELECT/INSERT on
   account tables. Runtime provisioning requires no DDL or account-state UPDATE.
   Apply migrations using the separate authorized migration role. The service
   never applies migrations at startup. Validate the restricted runtime role before
   enabling the app. Synthetic setup/migration tests use an owned administrator;
   a separate restricted-role test verifies the runtime permissions locally.
5. Check liveness/readiness, rejection cases and safe logs. Exercise real signing-
   key rotation, password/Key Vault-secret rotation and container revision refresh.
   Stage a new runtime credential, update the protected secret, refresh/restart the
   revision, verify readiness and retire the old credential without printing either.
6. Record development recovery objectives and perform a managed PostgreSQL restore
   into a new server, verify IDs/audits/ownership, and check authorized secret/DNS
   cutover. Never restore into or clear the owner's local library. Test migration
   failure under the real restricted deployment/runtime identities too.
7. Before each schema change, take/verify a backup and generate/review an idempotent
   migration script with `WISP_CLOUD_MIGRATION_CONNECTION` supplied privately. Prefer
   roll-forward for live data. The tested initial downgrade destroys its tables;
   do not use it as a production rollback or run it on a populated real environment.
8. Record incidents by safe request ID; investigate unavailable database, failed
   discovery, throttling or certificate problems without enabling secret-rich
   logging. Review operational alerts and restore evidence before storing real
   production account data. Production deployment remains a separate owner gate.

## Next decision

The code, migrations, synthetic proofs and template can merge independently.
Phase 2 remains open for cost approval, development provisioning, the actual
provider/native redirect proof and Azure operating exercises. Phase 3 must not
enable desktop login until those prerequisites are accepted. There is no cost
estimate or credit-coverage claim based solely on the large available credit balance.
