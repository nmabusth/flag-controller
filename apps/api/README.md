# Feature Flag API

## Getting started

The API requires Node.js 22 or newer and pnpm 11.11.0. Install workspace dependencies from the repository root, then run API commands from `apps/api`.

1. Install the workspace dependencies:
   ```bash
   pnpm install
   ```

2. Navigate to the API app directory:
    ```bash
    cd apps/api
    ```

3. Ensure PostgreSQL is running and create a database that matches the `DATABASE_URL` in your environment. See [Database](#database) below.

4. Create the API environment file and update the database connection details:
    ```bash
    cp .env.example .env
    ```

5. Build the shared types package, which the API imports at runtime:
    ```bash
    pnpm --dir ../../libs/shared-types build
    ```

The API runs database migrations automatically when it starts. To start it:

1. Start the server from the `apps/api` directory:
   ```bash
   pnpm start
   ```

`pnpm start` builds the API and starts the compiled server. It listens on `HOST` (default `127.0.0.1`) and `PORT` (default `8080`); set `HOST=0.0.0.0` when running inside a container. The API will be available at [http://localhost:8080](http://localhost:8080), and the Swagger documentation is available at [http://localhost:8080/documentation](http://localhost:8080/documentation).

## Environment Variables

From the `apps/api` directory, copy the example file and fill in the required values:

```bash
cp .env.example .env
```

Each variable is documented inline in `.env.example`. If you're running via Docker Compose, the `environment:` block in `docker-compose.yml` documents which variables need Docker-specific values. Anything not listed there flows through from your `.env` as-is.

## Available Scripts

Available scripts in package.json:

### `pnpm build`
Builds the application for production deployment

### `pnpm codegen:compile`
Compiles the GraphQL schema and generates TypeScript types

### `pnpm codegen:watch`
Watches for GraphQL schema changes and automatically regenerates TypeScript types

### `pnpm generate:migration`
Generates a new database migration file based on schema changes

### `pnpm migrate`
Runs pending database migrations

### `pnpm run:migration`
Generates a new migration and runs all pending database migrations. Use this after changing a Drizzle schema; for an existing checkout, use `pnpm migrate` to apply pending migrations without generating a new file.

### `pnpm start`
Builds the API and starts the compiled server

### `pnpm test`
Runs the test suite

### `pnpm update:schemas`
Runs the repo-level flagd schema sync command for the local API package


## Learn More

To learn Fastify, check out the [Fastify documentation](https://www.fastify.io/docs/latest/).


### Database

We use Postgres for our database.

In order to use the database for local development:

1. Ensure [Postgres](https://www.postgresql.org/) is downloaded for local development.
2. Create a local database, for example:
   ```bash
   createdb feature_flag_db
   ```
3. Ensure you have a `.env` file set up with a `DATABASE_URL` that points to this database. For example, update the placeholder URL in `.env.example` to `postgresql://<your-postgres-user>:<your-password>@localhost:5432/feature_flag_db?schema=public`.
4. From the `apps/api` directory, apply the committed migrations with `pnpm migrate`. This updates the database with the existing Drizzle migrations in `drizzle`.

#### Migrations

If the database schemas in `src/db/schema` change, we will need to generate a migration.

We generate migrations from the `apps/api` directory with `pnpm generate:migration` ([Drizzle migration documentation](https://orm.drizzle.team/docs/migrations)). The generated SQL file is written to `drizzle`.

To apply pending migrations from the `apps/api` directory: `pnpm migrate`

To generate a migration from the `apps/api` directory: `pnpm generate:migration`.

To generate and apply a migration from the `apps/api` directory: `pnpm run:migration`

##### Automatic database migrations with `RUN_MIGRATIONS_ON_START`

The application runs migrations before starting by default and shuts down if migration fails. Set `RUN_MIGRATIONS_ON_START=false` to skip startup migrations.

`pnpm migrate` applies the committed migrations in `drizzle` without starting the server.

### CORS

The UI forwards browser auth requests through its own origin, so CORS only matters for browsers that call the API directly.

The API requires credentials for CORS requests (`credentials: true`), which means wildcard (`*`) origins are not supported. You must specify explicit origins via the `CORS_ORIGIN` environment variable. By default, the API allows `http://localhost:3000`.

| Value | Behaviour |
|---|---|
| `http://localhost:3000` (default) | Allow the local development UI |
| `https://my-ui.example.com` | Allow a single origin |
| `http://localhost:3000,https://my-ui.example.com` | Allow multiple origins (comma-separated) |

#### Example `.env` entries

```
# Allow the local development UI (default)
CORS_ORIGIN=http://localhost:3000

# Restrict to a single origin
CORS_ORIGIN=https://my-ui.example.com

# Restrict to multiple origins (comma-separated)
CORS_ORIGIN=http://localhost:3000,https://my-ui.example.com
```

### Authentication (better-auth)

The API uses [better-auth](https://www.better-auth.com/) for server-side authentication.

> `BETTER_AUTH_URL` must be the UI's public URL, since the UI forwards `/api/auth/*` to this API. Set the GitHub OAuth callback to `<BETTER_AUTH_URL>/api/auth/callback/github`. `BETTER_AUTH_SECRET` is required when `NODE_ENV=production`. See `.env.example` for details.

The implementation is split across several files:

#### Auth instance configuration

In `src/auth.ts`, a `betterAuth` instance is created using the `better-auth/minimal` import with:

- **Database**: A Drizzle adapter backed by a PostgreSQL connection pool, using a dedicated auth schema defined in `src/db/schema/auth.ts`. The option `usePlural: true` maps to plural table names (`users`, `sessions`, `accounts`, etc.).
- **Plugins**: The `organization` plugin (with teams enabled) adds multi-tenancy support (organizations, teams, members, invitations).
- **Social Providers**: GitHub OAuth is configured via environment variables (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`).
- **Trusted Origins**: The UI origin (`http://localhost:3000`) is explicitly trusted.

#### Setting up the GitHub OAuth App

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` come from a GitHub OAuth App you create yourself. Set its authorization callback URL to this API's callback, e.g. `http://localhost:8080/api/auth/callback/github`.

- [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [Best practices for creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [better-auth GitHub provider](https://www.better-auth.com/docs/authentication/github)

#### Auth route handler (passthrough to better-auth)

`src/utils/authHandler.ts` acts as a bridge between Fastify and better-auth's web-standard `Request`/`Response` API:

1. Constructs a standard `Request` object from the Fastify request (URL, method, headers via `fromNodeHeaders`, and body).
2. Delegates to `auth.handler(req)` — better-auth's built-in handler that manages all `/api/auth/*` sub-routes (sign-in, sign-up, callback, session, sign-out, etc.).
3. Maps the web-standard `Response` back onto the Fastify `reply` (status, headers, body).

This handler is registered as a catch-all on both GET and POST:
- `GET /api/auth/*` — `src/routes/get/api/auth.ts`
- `POST /api/auth/*` — `src/routes/post/api/auth.ts`

#### Session validation hook (pre-validation)

`src/hooks/checkSession.ts` is registered as a `preValidation` hook in `src/utils/setup.ts`, meaning it runs before every route handler:

1. **Whitelisted routes** (defined in `src/utils/routeWhitelisted.ts`) skip session checks entirely — these include `/flagd`, `/documentation`, `/healthz`, and `/api/auth/*` paths.
2. For all other routes, it calls `auth.api.getSession()` with the request headers (converted via `fromNodeHeaders`). This is better-auth's server-side session introspection — it reads the session cookie/token and validates it against the database.
3. If a valid session exists, user details (`id`, `email`, `name`) and the active organization ID are extracted from the session and attached to `request.user` as `organizationId`.
4. If no valid session is found, the hook short-circuits with a **401 Unauthorized** response.

#### Request flow

```
Incoming Request
       │
       ▼
  Is /api/auth/* ?  ──Yes──▶  authHandler  ──▶  auth.handler(req)  ──▶  better-auth handles
       │                                         (login, callback, session mgmt)
       No
       │
       ▼
  Is whitelisted? ──Yes──▶  Skip auth, proceed to route handler
       │
       No
       │
       ▼
  checkSession hook
       │
       ├─ auth.api.getSession() ──▶ valid session ──▶ attach request.user ──▶ route handler
       │
       └─ no session ──▶ 401 Unauthorized
```

#### Key design decisions

- **Minimal import** (`better-auth/minimal`) keeps the server-side bundle lean.
- **Web-standard bridge**: Since better-auth uses the Fetch API `Request`/`Response`, `authHandler` manually converts between Fastify's Node.js-style request and the web-standard API. `fromNodeHeaders` from `better-auth/node` handles header conversion.
- **Cookie-based sessions**: The UI client uses `createAuthClient` pointed at the API, and the API's CORS config sets `credentials: true` so direct browser→API auth requests can carry cookies. This permits the exchange but does not widen cookie scope. See "Known limitation: cross-origin cookie sharing" below for deployment implications.
- **Session over JWT for route protection**: Rather than decoding JWTs directly, protected routes rely on `auth.api.getSession()` which does a server-side database lookup — providing revocable sessions rather than stateless JWT validation.

#### Default organization creation

Since the platform does not yet support user-facing organization management, every new user is automatically placed into a **default organization** so they can immediately access the system's multi-tenant features (teams, applications, feature flags, etc.).

When a new user is created, the API automatically checks whether a default organization already exists. If it does, the user is added with the `owner` role. If it does not, the organization is created with the user as its owner. New sessions also set that organization's ID as the active organization.

#### Cookies and deployment topology

Browsers reach Better Auth through the UI, which forwards `/api/auth/*` to this API. Better Auth's cookies are therefore set on the UI's origin, and the UI's server forwards them to the API on server-side requests. This works for any topology: same origin, sibling subdomains, unrelated domains, or platform domains like `*.run.app` and `*.vercel.app`. The API only needs to be reachable from the UI's server.

### flagd schemas

The flagd schemas are relied upon for routes which need to return data that is flagd compliant. The flagd schemas may need to be updated from time to time in the case that they may change.

The API package wrapper updates both committed schema JSON files and the generated shared TypeScript types. Run it from the `apps/api` directory:
`pnpm update:schemas`

CI runs the same sync flow and fails if it regenerates changes, so committed schema and type artifacts cannot silently drift.

#### Understanding how our database schema aligns with the flagd schema

Our `segments` align with the `$evaluators` object and therefore each `$evaluator` is a `segment` where each `flag`references a `segment` or `$evaluator` via a reference.

The following is an example of the flagd schema and how it references evaluators. Note that evaluators can be shared across feature flags.

```
{
  "$schema": "https://flagd.dev/schema/v0/flags.json",
  "flags": {
    "feature-1": {
      "state": "ENABLED",
      "defaultVariant": "false",
      "variants": {
        "true": true,
        "false": false
      },
      "targeting": {
        "if": [
          {
            "$ref": "emailWithFaas"
          },
          "true"
        ]
      }
    },
    "feature-2": {
      "state": "ENABLED",
      "defaultVariant": "false",
      "variants": {
        "true": true,
        "false": false
      },
      "targeting": {
        "if": [
          {
            "$ref": "emailWithFaas"
          },
          "true"
        ]
      }
    }
  },
  "$evaluators": {
    "emailWithFaas": {
      "ends_with": [
        {
          "var": "email"
        },
        "@faas.com"
      ]
    }
  }
}
```

#### Context evaluation
When mapping our DB schema to flagd, we may run into a case where a rule's condition needs to point to a subproperty of a context, for example `user.country` where `user` is the context and `country` is the attribute. To map this to the flagd schema, we can use simple dot notation to convey this as our `var`:

```
...
"targeting": {
  "if": [
    {
      "in": [
        {
          "var": "user.country" <-- Points to an object of user and the property of country
        },
        [
          "us",
          "ca"
        ]
      ]
    },
    "true"
  ]
}
...
```

`and`scenarios take in an array of conditions with the last value being the variation

`if` allows you to write if else statements by following a `[condition, variation match, else condition, else condition's variation match]`

`sem_ver` allows you to declare the context, operator, and version via this pattern
```
"sem_ver": [
  {
    "var": "version" <- context
  },
  ">=", <- operator
  "1.7.0" <- version
]
```


Fractional operations (rollouts) also have a distinct pattern in their definition. For example, a fractional rule which serves a variant of `red` or a variant of `green` based on a context value of `email` would look like this:
```
"fractional": [
  // Note using `cat` and `$flagd.flagKey` is the suggested default to seed your hash value and prevent bucketing collisions
  {
    "cat": [
      { "var": "$flagd.flagKey" },
      { "var": "email" } <- the context
    ]
  },
  // Split definitions contain an array with a variant and weight
  // Weights are relative — [50, 50] is equivalent to [1, 1]
  [
    "red", <- variant
    50 <- weight
  ],
  [
    "green", <- variant
    50 <- weight
  ]
]
```

For our usage, our rules will have some conditions that live as part of the rule definition. That would look more like this where the `fractional` variation serving is the `variant` argument:
```
"if": [
  {
    "==": [
      {
        "var": "user.language"
      },
      "english"
    ]
  },
  {
  "fractional": [
    {
      "cat": [
        { "var": "$flagd.flagKey" },
        { "var": "email" }
      ]
    },
    [
      "red",
      50
    ],
    [
      "green",
      50
    ]
  ]
  }
]
```

#### Fractionals and their relationship to rules

A **fractional** represents a weight-based rollout strategy served by a rule. The `rules` table owns the relationship: a rule points at what it serves through `serve_fractional_id` (a `fractionals` row) or `serve_variation_id` (a `flag_variations` row). The `rule_serve_target_at_most_one_check` constraint ensures a rule never sets both at once.

##### Condition-less rules

A rule's `conditions` column defaults to an empty array, so a rule can serve a fractional or variation without any conditions attached.

##### Fractional types

The `type` column on the `fractionals` table is constrained to one of two values:

| Type | `var` value | Description |
|---|---|---|
| `contextual` | A context attribute string (e.g. `email`, `user.id`) | The attribute referenced by `var` is concatenated with the flag key to seed the hashing algorithm. This ensures deterministic bucketing — the same context value always resolves to the same variant. |
| `weight-only` | `null` | No context attribute is used. Traffic is split purely by the defined weights without deterministic bucketing tied to a specific attribute. |

##### Weights

The `weights` column stores an array of `[variationId, weight]` tuples. Weights are **relative**, not absolute — for example, `[50, 50]` produces the same distribution as `[1, 1]`. Each tuple maps a variant to its proportional share of traffic.

## Architecture: Repository & Service Layer

The API follows a **Route → Service → Repository** pattern with predictable, low-surprise method contracts. This ensures that callers can reason about method behavior without reading implementation details.

### Core Principles

- **Predictable naming**: Use a small set of verbs with stable meanings (find, get, list, create, update, softDelete, hardDelete, restore, count, exists)
- **Explicit pagination**: Collections must be bounded by pagination or an explicit limit; no unbounded reads, a limit of -1 means no limit is applied
- **Soft-delete by default**: Soft-deleted rows are excluded unless explicitly requested via `include.deleted: true`
- **Opt-in relationships**: Related data is included through explicit `with` options
- **Clear responsibility**: Repositories handle persistence; Services orchestrate business logic, authorization, and mapping

### Method Naming Contract

| Verb | Return | Null Behavior | Usage |
|------|--------|---------------|-------|
| `findById` | Single record | Returns `null` | Optional reads |
| `getById` | Single record | Throws error | Required reads |
| `list` | Collection | Paginated | Many records (always paginated) |
| `count` | Number | N/A | Record counts |
| `exists` | Boolean | N/A | Existence checks |
| `create`, `update`, `softDelete`, `hardDelete`, `restore` | Mutation result | Varies | CRUD operations |

**Hard rule**: The same verb must mean the same thing across all entities. If `findById` returns null for teams, it returns null for applications too.

### Layer Responsibilities

**Repository Layer** (`repositories/`):
- Focus on database operations and query construction
- Join tables when necessary for efficiency
- Exclude soft-deleted rows by default
- Return nullable or thrown errors based on verb
- Keep method names short; type context is clear

**Service Layer** (`services/`):
- Add entity name to methods for clarity (e.g., `getTeamById`, `listApplications`)
- Orchestrate across repositories
- Apply business rules
- Call other services for meaningful orchestration
- Own transaction boundaries: wrap multi-step writes in `withTransaction` (see [Transactions](#transactions))

**Route Layer** (`routes/`):
- Delegate to services
- Map HTTP requests to service call parameters
- Handle HTTP-level concerns (status codes, headers)

### Transactions

Only services should start and end transactions. Repositories never create one.

Services get `withTransaction` (`utils/withTransaction.ts`), which runs the callback with repositories bound to a transaction. Throwing rolls back; returning commits.

```ts
return withTransaction(async (repos) => {
  const rules = await repos.rulesRepository.hardDeleteMany(ids);
  await repos.logsRepository.createMany(rules.map((rule) => toDeleteLog(rule, actorId)));
  return rules;
});
```

- Use the callback's `repos`, not the service's outer `repositories`.
- Repository methods that lock rows (`SELECT ... FOR UPDATE`) rely on the caller's transaction, so always call them through `withTransaction`.

### Filter Groups

Repositories can use the generic `FilterGroup<T>` type to express explicit AND and OR conditions:

Fields within each filter object are combined with AND. For example, logs can select entries matching a search term that are either associated with one of the team's applications or are team-specific entries for that team:

```ts
const filters: FilterGroup<LogsFilterFields> = {
  and: { search: 'checkout' },
  or: [
    { applicationIds: ['app-1'] },
    {
      subjectTypes: [SubjectType.Team],
      subjectIds: ['team-1'],
    },
  ],
};
```

### Examples

```typescript
// Repository: predictable, compact names
const team = await teamsRepository.findById(teamId, {
  with: { applications: true }
});

const result = await teamsRepository.list({
  filters: { search: 'platform' },
  with: { applications: true },
  sort: { field: 'name', direction: ColumnSortingDirection.ASC },
  pagination: { offset: 10, limit: 25 }
});

// Service: entity name included for readability
const team = await teamsService.getTeamById(teamId, {
  with: { applications: true }
});

const teams = await teamsService.listTeams({
  filters: { search: 'platform' },
  pagination: { page: 1, rows: 25 }
});
```

### Soft-Delete Contract

- Soft-deleted records are **excluded by default** in all reads
- Use `filters: { include: { deleted: true }}` to include soft-deleted rows
- Use `softDeleteById(id)` for reversible deletion
- Use `restoreById(id)` to restore soft-deleted records
- Reserve `hardDeleteById(id)` for compliance or maintenance only

### Best Practices Checklist

- [ ] Does the verb clearly signal one vs. many and null vs. throw behavior?
- [ ] Are collections paginated or explicitly limited?
- [ ] Are soft-deleted rows excluded by default?
- [ ] Are related records included only via explicit `with` options?
- [ ] Are filters grouped under `filters` rather than spread across many overloads?
- [ ] Does the service expose a controller-friendly shape?
- [ ] Would a caller guess the behavior from the method name alone?


### Testing

The **canonical test patterns** are documented in [src/test/README.md](./src/test/README.md). Follow those guidelines for route, service, and repository tests.

#### Route Tests (Most Common)

Use the bare `build()` function and mock services via `mockServices` from `test/testUtils.js`:

```ts
import build from 'test/app.js';
import { mockServices } from 'test/testUtils.js';

describe('POST /feature-flag', () => {
  it('creates a feature flag', async () => {
    vi.mocked(mockServices.featureFlags.createFeatureFlag)
      .mockResolvedValue({ id: 'flag-1', key: 'my-flag' });

    const app = build();
    const response = await app.inject({
      method: 'POST',
      url: '/application/test/feature-flag',
      body: { key: 'my-flag' },
    });

    expect(response.statusCode).toEqual(200);
    expect(mockServices.featureFlags.createFeatureFlag).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ key: 'my-flag' })
    );
  });
});
```

For a complete example, see [feature-flag.test.ts](./src/routes/post/application/[applicationId]/__tests__/feature-flag.test.ts).

#### Service Tests

Build real service instances with `createServiceWithMocks` and mock repositories:

```ts
import { createServiceWithMocks, mockRepositories } from 'test/testUtils.js';

describe('featureFlagService', () => {
  it('creates a flag', async () => {
    vi.mocked(mockRepositories.featureFlags.findByKey).mockResolvedValue(null);

    const service = createServiceWithMocks.featureFlag;
    const result = await service.createFlag({ key: 'my-flag' });

    expect(result.key).toEqual('my-flag');
  });
});
```

#### Repository Tests

Mock Drizzle using `mockDb()` from `test/mockDb.js`:

```ts
import mockDb from 'test/mockDb.js';

describe('featureFlagsRepository', () => {
  it('finds a flag', async () => {
    const [db, methods] = mockDb();
    methods.execute.mockResolvedValue([{ id: '1', key: 'flag-1' }]);

    const repository = createFeatureFlagsRepository(db);
    const rows = await repository.findAll();

    expect(rows[0].key).toEqual('flag-1');
  });
});
```


### On data creation for the benefit of the user

#### Why do we create two records - one for development and one for production?
You may notice that items like feature flags through `POST /application/:applicationName/feature-flag` and segments through `POST /application/:applicationName/segment` are automatically created for the user twice - one for development and one for production. This is because instead of creating an interface where the user needs to hit the api twice, we go with the current default of there being only two environments and create the items for them through our initial `POST` request.

We will need to account for more environments in the future post-MLP, but it is important to understand why the code is creating two of these items and two entries for the audit logs as well - to create a more seamless, hands-off approach in the creation of records.


#### Audit log entries
Every CUD operation *must* write to the `logs` table. We need to ensure each route writes to the `logs` table so that every action has a recorded event.

## FAQ / Troubleshooting
1. Issue: When starting the API with `pnpm start`, you encounter `Module not found`.
- Solution: From the `apps/api` directory, run `pnpm --dir ../../libs/shared-types build`. This builds the library if it has not been built yet.

2. Failure to update schemas when running `pnpm update:schemas`
- This is common behind corporate proxies or networks that use TLS-intercepting certificates not trusted by Node.js.
- Recommended solution: Point Node.js at your corporate CA certificate so TLS verification remains intact:
  ```bash
  NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem pnpm update:schemas
  ```
- Last resort (**local development only**): Disable certificate verification entirely:
  ```bash
  NODE_TLS_REJECT_UNAUTHORIZED=0 pnpm update:schemas
  ```
  ⚠️ **Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` in production or CI** — it disables all TLS verification and exposes you to man-in-the-middle attacks.