---
name: react
description: React rules for a code review. Flags component code that renders wrong, leaks, races or locks out users in ways the hooks lint cannot see. Covers state derived in effects, effects that race or never clean up, stale closures, unstable identities that defeat memoisation, keys that lose state, uncontrolled-to-controlled switches, server data copied into local state, HTML injected from untrusted input, secrets in client bundles, error and loading states left out, and interactive elements no keyboard or screen reader can use. Use as a review lens or as a stamp rule pack.
---

# react

A component is correct when it shows the right thing for every state it can
be in, and stops doing work once it is gone. Review whether this change keeps
each render a pure function of props and state, keeps effects for
synchronising with the outside world, and keeps every user able to reach what
it renders.

## Review

- **derived-state-effect**: Values computable from props or state are computed during render (or with `useMemo` when costly), never copied into state by an effect. Flag: `useEffect(() => setX(f(props.y)), [props.y])`, state that mirrors a prop, a chain of effects each setting state for the next. Why: an extra render with stale values on screen, and two sources of truth that drift.
- **effect-race**: An effect that fetches or subscribes ignores results that arrive after its inputs changed or the component unmounted: an `AbortController`, an `ignore` flag, or the data library's own cancellation. Flag: `fetch(...).then(setData)` in an effect with no abort or ignore, a subscription with no unsubscribe in the cleanup. Why: a slow old response overwrites the new one, and the user sees data for the wrong id.
- **effect-cleanup**: Every timer, listener, observer, socket or subscription an effect starts is stopped in its cleanup. Flag: `setInterval`, `addEventListener`, `new IntersectionObserver`, a WebSocket opened in an effect with no returned cleanup, or a cleanup that removes a different function than was added. Why: leaks and duplicate handlers that grow with every mount, doubled under Strict Mode.
- **stale-closure**: A callback stored for later (an interval, a listener, a debounced function, a ref callback) reads current state through the setter's updater, a ref, or its dependencies. Flag: a `setInterval` in a mount-only effect that reads state, `setCount(count + 1)` inside a long-lived callback, a `useCallback` with a deliberately trimmed dependency list. Why: the callback acts on the values from its first render, silently.
- **unstable-identity**: An object, array or function created during render and passed to a memoised child, a context value, or a dependency array is stabilised when its identity matters. Flag: `value={{ user, setUser }}` on a context provider, an inline object in a `useEffect` dependency list, a fresh callback into a `React.memo` child that the change made memoised. Why: every render re-runs the effect or re-renders every consumer, and the memoisation buys nothing.
- **key-identity**: List keys come from the item's stable identity. Flag: index keys on a list that can reorder, insert or delete; `Math.random()` or a fresh id generated during render; a key that changes when the item is edited. Why: React reuses the wrong component, so input text, focus and local state jump to another row.
- **controlled-switch**: An input stays either controlled or uncontrolled for its whole life. Flag: `value={maybeUndefined}`, `value` without `onChange` and without `readOnly`, `defaultValue` changed after mount expecting the input to follow. Why: React warns and the field stops reflecting state, so the user's edit or the reset is lost.
- **server-state-copy**: Data from the server lives in the data-fetching cache (React Query, SWR, the router's loader), not copied into `useState` or a global store. Flag: a query result copied into state on success, a store that holds fetched rows with no invalidation, a mutation that updates local state but not the cache. Why: screens disagree after a mutation, and refetches overwrite edits.
- **html-injection** [refuse]: `dangerouslySetInnerHTML`, `innerHTML`, `href`/`src` built from data, and `eval`-like APIs take only sanitised or trusted content. Flag: `dangerouslySetInnerHTML={{ __html: userText }}` with no sanitiser, a `javascript:` URL reachable from user input, markdown rendered to HTML without sanitising. Why: stored XSS runs as the signed-in user.
- **client-secret** [refuse]: Nothing secret reaches code that ships to the browser. Flag: an API key, private token or service credential in a component, a client-exposed env var (`VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`) holding a secret, a server-only module imported into a client component. Why: anything in the bundle is public.
- **async-states**: A component that loads or mutates data renders its loading, empty and error states, and disables or guards a submit while it is pending. Flag: a fetch with only a success branch, a list with no empty state, a submit button that can fire twice, an error swallowed into a blank screen with no error boundary. Why: users see nothing, retry, and create duplicates.
- **accessible-interaction**: Interactive elements are real controls with accessible names. Flag: `onClick` on a `div` or `span` with no role, tab stop and key handler; an icon-only button with no label; an image that carries meaning with no `alt`; a modal that does not move or trap focus; custom form fields with no associated label. Why: keyboard and screen-reader users cannot use the feature, a legal exposure as well as a defect.

## Fix

- Prefer: computing in render, the data library the repository already uses for server state, the existing design-system components for controls and dialogs, and the repository's sanitiser for HTML.
- Never touch: shared design-system components, lint configuration, or the data library's global client setup.
- Escalate: introducing a new state, data or sanitiser library; a change to a context's value shape that consumers outside the PR read; and any `client-secret` break, since the key must be rotated as well as removed.
