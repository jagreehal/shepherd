---
name: nextjs
description: Next.js rules for a code review, meant to be composed with the react lens. Flags App Router and Pages Router code that leaks data across the server/client boundary, skips authorisation, caches the wrong thing or ships too much to the browser. Covers route handlers and server actions without auth, middleware matchers that miss routes, server-only code reaching the client, props that serialise secrets, user data cached across users, dynamic APIs that break static rendering, redirects built from input, unvalidated action input, heavy client bundles, and metadata or image misuse. Use as a review lens or as a stamp rule pack.
---

# nextjs

Next.js decides per file where code runs and what gets cached. Review whether
this change keeps secrets and per-user data on the server, checks who is
asking at every entry point, and caches only what is the same for everyone.
React component rules belong to the react lens; this one covers what the
framework adds.

## Review

- **handler-auth** [refuse]: Every route handler (`app/**/route.ts`, `pages/api/**`) and every server action checks authentication and authorisation itself, for the resource it touches. Flag: a handler or action that reads or writes data with no session check, an ownership check missing on an id from the request, reliance on a page-level check that the endpoint does not repeat. Why: server actions and API routes are public HTTP endpoints anyone can call directly.
- **middleware-matcher**: Middleware that enforces auth or headers covers every route it means to. Flag: a `matcher` that excludes `/api`, a negative lookahead that also skips a new protected segment, a new route outside the matcher, auth enforced only in middleware with no check in the handler. Why: the protected route is reachable by skipping the matcher.
- **server-only-boundary**: Modules that read secrets, the database or server env are marked `import "server-only"` (or live where client code cannot import them), and `"use client"` files import none of them. Flag: a database client, ORM model or secret-reading helper imported from a client component, a `"use client"` added to a file that imports server code. Why: the build bundles it for the browser or fails late in production.
- **serialised-props** [refuse]: Data passed from a server component to a client component, or returned from `getServerSideProps`/`getStaticProps`, holds only what the client may see. Flag: a whole user or database row passed as a prop, password hashes, tokens or internal fields in props, a server action returning more than the caller needs. Why: every prop is serialised into the HTML payload, readable in view-source.
- **per-user-cache**: Responses and data that depend on the user, cookies or headers are not cached for everyone. Flag: `fetch` with `force-cache` or `revalidate` on a per-user request, `unstable_cache`/`"use cache"` wrapping a function that reads the session without the user in its key, a route segment marked static that reads cookies. Why: one user's data is served to the next.
- **stale-after-mutation**: A server action or route handler that changes data revalidates what shows it (`revalidatePath`, `revalidateTag`, `router.refresh()`). Flag: a mutation with no revalidation of cached pages or tags that list the changed data. Why: users see the old value after saving and retry.
- **action-input**: Server action and route handler input is parsed and validated at the boundary before use. Flag: `formData.get(...)` cast straight to a type, a JSON body spread into a database call, a search param used as a number without parsing. Why: anyone can post any shape to the endpoint.
- **open-redirect**: `redirect()`, `NextResponse.redirect` and `router.push` with a URL from the request go only to same-origin paths or an allow-list. Flag: `redirect(searchParams.get("next"))`, a `callbackUrl` passed through unchecked. Why: phishing through a trusted domain.
- **public-env** [refuse]: `NEXT_PUBLIC_*` variables hold only values safe to publish. Flag: a key, token, internal URL or credential under a `NEXT_PUBLIC_` name, a server secret renamed to `NEXT_PUBLIC_` to make a client component work. Why: Next.js inlines every `NEXT_PUBLIC_` value into the client bundle.
- **dynamic-api-placement**: `cookies()`, `headers()`, `searchParams` and `noStore` are read only in the segments that need them. Flag: a dynamic API added to a layout or a shared component that makes every page under it dynamic, a static marketing page turned dynamic by a helper call. Why: the whole subtree loses static rendering and caching, and latency jumps.
- **client-bundle-weight**: Large or browser-only dependencies (editors, charts, maps, PDF, date libraries with locales) load with `next/dynamic` or in a server component. Flag: a heavy library imported at the top of a client component on a common route, `"use client"` added high in the tree so a whole page becomes client code. Why: every visitor downloads and parses it on first load.
- **framework-primitives**: Pages use `next/image` with dimensions or `fill` and sizes, `next/link` for internal navigation, and `generateMetadata`/`metadata` for titles. Flag: a raw `<img>` for content images without dimensions, `<a href>` for internal routes in a client app, `remotePatterns` widened to `**`. Why: layout shift, full reloads, and an image optimiser anyone can use as a proxy.

## Fix

- Prefer: the repository's existing auth helper (`auth()`, `getServerSession`, its own wrapper) at the top of each handler or action, its validation schemas, `server-only` imports, and narrowing props to a view type.
- Never touch: `next.config.*`, middleware matchers beyond the route in the PR, caching defaults for the whole app, or the auth provider setup.
- Escalate: any `handler-auth`, `serialised-props` or `public-env` break that changes who can see data in production, changing a matcher, and moving a large subtree between server and client.
