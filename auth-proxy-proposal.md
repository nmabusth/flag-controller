# Proposal: Route Better Auth through the UI

## Summary

When the UI and API are hosted on different sites, GitHub sign-in fails. The browser discards the cookies Better Auth sets, so the OAuth flow can't finish and the UI never gets a session. We fixed it by having the UI forward `/api/auth/*` to the API. Every auth cookie then belongs to the UI's own domain. It's one small change in `apps/ui/proxy.ts` and works no matter where the two services are hosted. We'd like to make it the standard setup.

## What happened

We deployed the API and UI as two Cloud Run services:

- `flag-controller-api-….run.app`
- `flag-controller-ui-….run.app`

GitHub sign-in failed every time. The API logs showed the same sequence on each attempt:

```
POST /api/auth/sign-in/social             200
GET  /api/auth/callback/github?code=…     302
GET  /api/auth/error?error=state_mismatch 302
GET  /?error=state_mismatch               401
```

## Root cause

There are two separate problems. Fixing either one alone isn't enough.

### 1. The OAuth state cookie is dropped

`run.app` is on the [Public Suffix List](https://publicsuffix.org/), so browsers treat each `*.run.app` subdomain as a **separate site**. The same applies to `vercel.app`, `herokuapp.com` and similar platform domains.

1. The UI calls `POST {API}/api/auth/sign-in/social` from the browser. This is a cross-site `fetch`.
2. The API responds with `Set-Cookie: __Secure-better-auth.state=…; SameSite=Lax`.
3. Browsers don't store a `SameSite=Lax` cookie that arrives on a cross-site request, so the cookie is dropped.
4. GitHub redirects back to `{API}/api/auth/callback/github`. The state cookie isn't there, so Better Auth returns `state_mismatch`.

### 2. The session cookie lives on the wrong domain

Suppose the state cookie survived, for example with `SameSite=None`. The session cookie would still be set on the **API's** domain. However, the UI checks sessions from its own server:

- `utils/apiRequest.ts` and `actions/getBetterAuthHeaders.ts` take the `cookie` header the **browser sent to the UI** and forward it to the API.
- The browser never sends the API's cookies to the UI's domain.
- So every request from the UI's server would be unauthorized.

The design assumes the browser holds the session cookie for the UI's domain. Today that only works when the UI and API share a parent domain and `AUTH_COOKIE_DOMAIN` is set.

## Options considered

| Option | Works on `*.run.app` / `*.vercel.app`? | Drawbacks |
|---|---|---|
| **A. Shared parent domain** (`app.example.com` + `api.example.com`, `AUTH_COOKIE_DOMAIN=example.com`) | No, it needs a custom domain | Requires owning a domain plus DNS and certificate setup for every environment. Preview and ephemeral environments are out. |
| **B. Cross-site cookies** (`SameSite=None`) | Partly | Safari already blocks third-party cookies, and other browsers increasingly do. It also does nothing for problem 2. |
| **C. Proxy `/api/auth/*` through the UI** ✅ | Yes | One extra network hop for auth calls only (details below). |

## Proposed solution (option C)

The browser only ever talks to the UI's domain. The UI forwards auth calls to the API.

```
Browser ──► UI /api/auth/*  ──(rewrite)──►  API /api/auth/*
        ◄── Set-Cookie (UI domain) ◄─────── Better Auth response
```

**Code (already done on `vercel-hosting`):** `apps/ui/proxy.ts` rewrites any `/api/auth/*` request to `API_BASE_URL`. It's about 10 lines with unit tests. The URL is read when the server runs, not baked in at build time, so one image works in every environment.

**Config per environment:**

| Variable | Value |
|---|---|
| API `BETTER_AUTH_URL` | UI address (used for the OAuth `redirect_uri` and redirects) |
| UI `API_BASE_URL` | API address, only needs to be reachable from the UI's server |
| GitHub OAuth callback | `{UI}/api/auth/callback/github` |

**What this lets us remove:**

- UI `NEXT_PUBLIC_BETTER_AUTH_URL` and its Docker build arg. The browser's auth client uses the page's own origin, so one UI image runs in every environment.
- UI `BETTER_AUTH_URL`, which was the docker-compose workaround for the UI's server reaching `http://api:8080` while the browser used `http://localhost:8080`. Server actions now use `API_BASE_URL`.
- API `AUTH_COOKIE_DOMAIN` and the `crossSubDomainCookies` setup. Cookies are always first-party on the UI's origin.
- `CORS_ORIGIN` for auth, since browsers no longer call the API directly.

**What we verified on Cloud Run:**

- `{UI}/api/auth/ok` returns the API's response.
- `sign-in/social` now sets the `__Secure-better-auth.state` cookie on the UI's domain.
- The GitHub `redirect_uri` points at the UI.
- Full GitHub sign-in works end to end in the browser, and the UI picks up the session.

## Why this is the right default

- **First-party cookies only.** Browser restrictions on third-party cookies don't affect us.
- **Works anywhere.** It doesn't matter whether the hosting is Cloud Run, Vercel, a preview build or a custom domain. No custom domain or `AUTH_COOKIE_DOMAIN` is needed. If we later add a shared domain, it still works.
- **Matches the existing design.** The UI's server already forwards browser cookies to the API. This change just makes sure those cookies are on the UI's domain.
- **Fewer moving parts.** Auth no longer depends on CORS or cross-site cookie settings. `CORS_ORIGIN` only matters for any other direct browser-to-API calls.
- **Small and reversible.** It's one file. If `API_BASE_URL` is unset, nothing is rewritten, and local dev keeps working unchanged.

## Trade-offs

- Auth calls make one extra hop through the UI's server. These are infrequent: sign-in, sign-out and session checks.
- The UI must be running for auth to work. In practice that's already true, since users sign in through the UI.
- Auth depends on the Next.js rewrite passing `Set-Cookie` and redirects through unchanged. It does today; we should have a test or smoke check that guards it.

## Next steps

1. Review and merge `vercel-hosting` into `main`. The UI build trigger deploys from `main`, so without the merge the next deploy would go out without this fix.
2. Migrate existing deployments: set the API's `BETTER_AUTH_URL` to the UI's URL, change the GitHub OAuth callback to the UI, and drop `AUTH_COOKIE_DOMAIN`, `NEXT_PUBLIC_BETTER_AUTH_URL` and the UI's `BETTER_AUTH_URL`. Users will need to sign in again once.
