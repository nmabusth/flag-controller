# Flag Controller UI

A [Next.js](https://nextjs.org/) application built with React and the [Carbon Design System](https://carbondesignsystem.com/) that provides the interface for managing feature flags.

## Prerequisites

- **Node.js** `>=22`
- **pnpm** — this repo pins the package manager via `packageManager` in the root `package.json`. Enable it with [Corepack](https://nodejs.org/api/corepack.html):
  ```bash
  corepack enable
  ```
- **A running API and database.** The UI is a client for the Fastify API and does not work on its own — you need the API and its Postgres database running for authentication and data. See the [root README](../../README.md) for the full stack setup and the [API README](../api/README.md) for API and database details.

## Getting Started

1. Install dependencies from the **repository root** (this installs all workspace packages):
   ```bash
   pnpm install
   ```

2. Create your environment file (see [Environment Variables](#environment-variables) below):
   ```bash
   cp apps/ui/.env.example apps/ui/.env
   ```

3. Make sure the API and database are running (see the [root README](../../README.md)).

4. Start the UI development server:
   ```bash
   cd apps/ui
   pnpm dev
   ```

The UI will be available at [http://localhost:3000](http://localhost:3000). The root path (`/`) redirects to `/flags`.

## Running Tests

Tests are run with [Vitest](https://vitest.dev/):

```bash
pnpm test        # run the test suite once
pnpm test:unit   # run in watch mode
pnpm test:ci     # run with coverage (used in CI)
```

### Mocking API calls

In component and feature tests, mock the network boundary with `global.fetch`. Do not mock modules under `api/requests`, React Query hooks, queries, or mutations. Keeping those layers real ensures tests exercise request construction, query behavior, and component integration together.

Use `resolvePromiseWithData` to create the mocked response:

```tsx
import { beforeEach, vi } from 'vitest';

import resolvePromiseWithData from '../../../test/resolvePromiseWithData';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    resolvePromiseWithData({ data: [], metadata: { totalRecords: 0 } }),
  );
});
```

Use `mockResolvedValueOnce` when a test makes multiple requests that need different responses. If the code under test does not make a request, do not add a fetch or request mock.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn/foundations/about-nextjs) - an interactive Next.js tutorial.

## Carbon Design System
We use the [Carbon Design System](https://carbondesignsystem.com/) React library to build almost all of our components.

Design tokens are used throughout for handling spacing, typography styling, and colors.
- [Spacing tokens](https://carbondesignsystem.com/elements/spacing/overview)
- [Color tokens](https://carbondesignsystem.com/elements/color/tokens)
- [Typography type sets](https://carbondesignsystem.com/elements/typography/overview/)

The icons are pulled directly from the [icons library](https://carbondesignsystem.com/elements/icons/library/) and are available as React components. For example, if you wanted to use the Play icon, you would import the component and use it as `<Play />`:

```tsx
import { Play } from "@carbon/icons-react";

....
return <Play />;
...
```

## Environment Variables

Create a `.env` file for local development. Use `.env.example` as the template — copy it and fill in any values as needed:

```bash
cp .env.example .env
```

The UI reads the following variables:

| Variable | Description |
|----------|-------------|
| `API_BASE_URL` | API base URL for server-side requests and for forwarding the browser's `/api/auth/*` requests. Only needs to be reachable from the UI's server; use the Docker service name in containerized environments. |

> **Note:** GitHub OAuth credentials (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`) are configured on the **API**, which acts as the auth server — not in the UI. See the [API README](../api/README.md) for how to set up the GitHub OAuth provider.

## Authentication

We use [Better Auth](https://www.better-auth.com/) to handle authentication between the Next.js UI and the Fastify API backend. The API acts as the auth server while the UI uses the Better Auth React client to interact with it.

The browser only ever talks to the UI's origin. `proxy.ts` forwards every `/api/auth/*` request to `API_BASE_URL`, so Better Auth's cookies are first-party cookies on the UI's origin, wherever the API is hosted. The UI's server then forwards those cookies to the API on each server-side request.

For details on how the API handles auth (route handling, session validation, etc.), see the [API README](../api/README.md).

### Auth Client

The auth client is created in `lib/auth-client.ts` using `createAuthClient` from `better-auth/react`. It is configured with:

- **`baseURL`** — In the browser, the page's own origin, so auth requests (sign-in, sign-out, session checks) go through `proxy.ts`. In server actions, `API_BASE_URL`, so they call the API directly.
- **`organizationClient()` plugin** — Enables multi-tenant organization and team support on the client.

Key usage patterns:

| Action | Method |
|--------|--------|
| Login (GitHub OAuth) | `authClient.signIn.social({ provider: "github" })` |
| Logout | `authClient.signOut()` |
| Server-side session check | `getSession()` (server-side fetch to the API's `/api/auth/get-session` endpoint) |
| Client-side session | `authClient.useSession()` (React hook) |

### Auth Flow

1. User visits a protected page → `getSession()` forwards the incoming cookie header to the API's `/api/auth/get-session` endpoint and returns the full Better Auth session.
2. If no valid session exists, the user is redirected to `/login`.
3. User clicks "Login" → `authClient.signIn.social({ provider: "github" })` posts to the UI's `/api/auth/sign-in/social`, which is forwarded to the API. The API sets the OAuth state cookie on the UI's origin and redirects the browser to GitHub.
4. GitHub redirects back to the UI's `/api/auth/callback/github`, which is forwarded to the API. Better Auth creates a session, sets the session cookie on the UI's origin, and redirects to the UI.
5. Server-side requests forward the browser's cookie header to the API (see `utils/apiRequest.ts`).
6. On logout, `authClient.signOut()` posts to the UI's `/api/auth/sign-out`, which is forwarded to the API to clear the session, and the UI redirects to `/login`.

### Server Action Pattern: `withSessionAction`

For server actions that require a session, use `withSessionAction` from `actions/withSessionAction.ts` as the standard wrapper pattern.

Why we use it:

- Calls `getSession()` once and passes the resolved session into the wrapped action.
- Gives actions direct access to session fields (for example `activeOrganizationId`) for organization-scoped behavior.

This keeps server actions consistent and reduces repeated auth/session boilerplate.

## Other

### ID generation for pending, unsaved items
We use `Math.random` to generate non-permanent short-lived ID's for items such as conditions or rules in their pending, unsaved state. We could use a library to generate the ID, but the chances of the same number being returned by `Math.random` is small enough compared to the number of pending items created at any one time.

### Components & Features

The current architecture of the application divides React Components between components and features (each has their own directory).

A component is anything that is I/O (input/output) meaning that it receives props and just returns elements without state handling, hook usage, etc.

A feature is anything that does more than just I/O - it handles state, makes requests, etc.

### Form data processing and input validation
Use native `FormData` for form submission and keep parsing in a utility. For repeated fields, use stable IDs and `getAll` to preserve their order:

```ts
const formData = new FormData(form);
const items = parseFormData(formData);
```

For one-off parsing, use a focused parser with the relevant field or item identifier:

```ts
const item = parseItem(formData, itemId);
```

Keep parsing utilities in `utils/` and use them to normalize form values before passing data to actions or API requests.

Use `useInputValidation` for reusable native validity handling and field-level Zod validation. Pass a Zod schema to the hook; it handles schema messages, native browser messages, and optional server errors. Use `onChange` or `onBlur` only for validation that depends on other form fields:

```tsx
import { z } from 'zod';

const validation = useInputValidation({
  schema: z.string().min(1, 'This field is required.'),
  serverError: formState.errors?.fieldErrors?.fieldName,
});

return (
  <TextInput
    required
    onInvalid={validation.handleInvalid}
    onBlur={validation.handleBlur}
    onChange={validation.handleChange}
    invalid={!!validation.error}
    invalidText={validation.error}
  />
);
```

The hook joins array-valued server errors automatically. Keep cross-field checks in `onChange` or `onBlur`, where the current form is available. Client validation takes precedence over server errors.

Define a Zod schema once in `schemas/` and reuse it in the server action and the client input hook. Pass `schema.shape.fieldName` to `useInputValidation` so browser messages and server field errors use the same rules.

When a field becomes locally valid, `useInputValidation` clears its prior server error. On a successful action, return a fresh `{ form, status: ActionStatus.Success }` state rather than spreading `prevState`, so stale field errors and `actionError` notifications do not remain after a successful retry.

For repeated inputs, use `FormData.getAll()` rather than `Object.fromEntries()` so duplicate field names retain their rendered order. Components without a native input event, such as Carbon `ComboBox` and `FilterableMultiSelect`, need their own selection state and submission value; map any server error to their `invalid` and `invalidText` props directly.

We intentionally do not use a form-state library such as React Hook Form for this pattern. These forms submit native `FormData` directly to Next.js server actions, and the UI already uses Carbon inputs with browser-native validity handling. `useInputValidation` keeps field-level client validation, shared Zod schemas, and server action errors aligned without introducing a second form state or submission model. A form library may be appropriate for a workflow that needs substantially more form-state orchestration, but it should not be added solely for basic field validation.

Validated server actions should use `ActionState<Form>` from `typings/common` as their return state. Build `rawFormData` with `Object.fromEntries(formData.entries())`, validate it with a shared Zod schema, and use `validatedFields.data` for API payloads and successful action state. Cast `rawFormData` only when returning rejected form values with `z.flattenError(...)`. Report `ActionStatus.Success` or `ActionStatus.Error` in `status`, and use `errors.actionError` for request or system failures. This keeps actions compatible with `useActionState`, `useInputValidation`, and the shared field-error presentation pattern.

### Modal placement in table components

When rendering modals inside table components, always place them **after** the `TableContainer` at the bottom of the JSX tree. This keeps the component structure consistent across all tables and makes it easy to find modals at a glance.

```tsx
return (
  <>
    <TableContainer ...>
      ...
    </TableContainer>
    <SomeModal open={!!selectedItem} onClose={handleClose} ... />
  </>
);
```

### Modal success handling for server-side form submissions

When a modal submits through a server action and already uses `SubmitButton`, prefer `onSubmitDone` for success side effects. The callback runs after the button observes a successful action and can notify the parent, close the modal, refresh data, or navigate.

Pattern:

- Modal owns form submission state via `useActionState`.
- Modal exposes an `onSuccess` prop when the parent owns the side effect.
- Modal passes a callback to `SubmitButton.onSubmitDone`.
- The callback reads the successful form value from the latest action state when needed.

Use a success `useEffect` when the effect must observe action state independently of a `SubmitButton`, coordinate multiple pieces of state, or run for submissions that can complete through another path. Keep side effects in the parent component where practical.

```tsx
const [formState, formAction] = useActionState(createSomething, initialActionState);

useEffect(() => {
  if (formState.status === ActionStatus.Success) {
    onSuccess(formState.form.name);
  }
}, [formState.status, onSuccess, formState.form.name]);
```

Use this pattern as the standard for new server-action modals (for example, `CreateTeamModal` and `CreateApplicationModal`).

### Carbon Tabs and React Activity Component

When using Carbon Design System's `Tabs` component, be aware of an important consideration regarding UI state preservation and search parameters.

Carbon tabs do not unmount tab panels when switching between tabs - we should be aware of the side effects that come with this when using search parameters for fetching data: If you update search parameters that trigger data fetching in another tab, React's effects will fire in the hidden tab even though the user can't see it.

In order to solve for this, use the React `Activity` component to wrap tab content based on the currently selected tab. This ensures that components only fetch data when their tab is actually visible to the user, preventing unnecessary network requests when search parameters change.
