# Research Report: React 19 Component Lifetime, External Store Contracts & Effect Timing

## Executive Summary
Analysis of React 19 core lifetime semantics relevant to PR #52. Evaluates state preservation across tree moves/conditional branches, `useSyncExternalStore` snapshot invariants, and effect timing during DOM/tree reparenting. Provides concise, checkable constraints and review hazards for PR evaluation.

## Primary Sources Consulted
1. React Documentation: *Preserving and Resetting State* — `https://react.dev/learn/preserving-and-resetting-state`
2. React API Reference: *useSyncExternalStore* — `https://react.dev/reference/react/useSyncExternalStore`
3. React API Reference: *useEffect* — `https://react.dev/reference/react/useEffect`

## Checkable Constraints & Technical Specifications

### 1. State Preservation Across Tree Moves & Conditional Branches
- **Address in Render Tree**: React ties component state (hooks, DOM nodes) strictly to its structural address (path from root) in the render tree, not lexical JSX declaration.
- **Branch Alternation Teardown**: In `condition ? <A><KeepAlive /></A> : <B><KeepAlive /></B>`, switching `condition` destroys `<KeepAlive />` state and recreates it because parent element type/slot changes.
- **Branch Hoisting**: Moving `<KeepAlive />` *above* responsive branches (`<div><KeepAlive />{isMobile ? <MobileUI /> : <DesktopUI />}</div>`) guarantees invariant tree address across viewport breakpoint switches. State, DOM nodes, and effects persist without remounting.
- **Explicit Keys**: React matches same component type at same sibling position. When siblings reorder or conditionally appear, explicit stable `key` props must be supplied; otherwise React reconciles mismatched instances or resets state.

### 2. useSyncExternalStore Snapshot & Subscription Contracts
- **Referential Stability (`Object.is`)**: `getSnapshot` must return the identical value/reference (`Object.is(prev, next) === true`) if underlying store data did not mutate.
- **Anti-Pattern (Uncached Objects)**: If `getSnapshot` generates fresh object/array literals or transformed records per call (e.g., `{ ...profile }`), React throws error: *"The result of getSnapshot should be cached"* or triggers infinite render loops.
- **Subscription Stability**: `subscribe(listener)` must have stable function identity (module scope or `useCallback`). Passing an inline closure forces React to resubscribe on every render (`unsubscribe()` old, `subscribe()` new).
- **Concurrent Transition Contract**: During non-blocking transitions, React re-evaluates `getSnapshot` immediately before DOM commit. If mutated mid-transition, React restarts update as blocking. Mutations must never occur during render.

### 3. Effect Timing & DOM Reparenting
- **Commit & Teardown Sequence**:
  - `useLayoutEffect` cleanup runs synchronously before DOM mutation; `useLayoutEffect` setup runs synchronously after DOM mutation before browser paint.
  - `useEffect` cleanup runs asynchronously after DOM mutation and layout/paint; `useEffect` setup runs asynchronously after cleanup.
- **React Remount vs DOM Reparent**:
  - If a component moves across tree branches (unmount + mount elsewhere), all cleanups execute, destroying internal listeners, timers, and xterm/canvas sessions; subsequent setup creates fresh instances.
  - React 19 does not natively reparent DOM nodes across arbitrary JSX branches without remounting (unless using `<Activity>`/Offscreen or portals). Manual DOM reparenting (e.g. `appendChild`) bypasses React lifecycle, causing DOM state drift (focus lost, layout desync) while React effects remain unaware.
- **Keep-Alive In-Place**: When kept mounted continuously above responsive branches, zero teardown/setup effects run on resize. Responsive recalculations require dedicated resize listeners or responsive prop dependencies rather than mount effects (`[]`).

### 4. Review Hazards for PR #52 Surfaces

#### Hazard A: Keep-Alive Moved Above Responsive Branch
- **Check**: Verify `<KeepAlive>` wrapper is structurally identical across responsive re-renders (no conditional parent DOM wrapper changing tag type or key).
- **Hazard**: If responsive switch changes wrapper from e.g. `<div className="desktop">` to `<section className="mobile">`, the subtree remounts and all terminal/session state is wiped.
- **Hazard**: If component stays mounted but is visually hidden (e.g. `display: none`), xterm/canvas resize observers or geometry calculations reading `clientWidth`/`clientHeight` will report 0 dimensions, corrupting pty row/col calculation unless guarded.

#### Hazard B: Status Profile Subscriptions
- **Check**: Inspect `getSnapshot` implementation for status profiles.
- **Hazard**: Returning computed objects without referential caching (e.g. deriving status profile from agent/session state inside `getSnapshot` on each call) violates the snapshot contract and causes render thrashing or React error.
- **Hazard**: Ensure `subscribe` callback accepts a parameter-less listener and properly detaches upon cleanup.

#### Hazard C: Memoized Mounted Session Membership
- **Check**: Inspect memoized data structure tracking mounted sessions (e.g. `useMemo(() => new Set(...), [deps])`).
- **Hazard**: `useMemo` does not provide semantic lifetime guarantee; React may drop memoization cache under memory pressure.
- **Hazard**: If session membership calculation has missing dependencies or performs mutable in-place mutations of cached Sets/Arrays, React fails to detect session additions/removals, causing zombie sessions or premature unmounting.
- **Hazard**: If mounted session membership array/Set changes reference on unrelated state updates, child keep-alive sessions may re-render unnecessarily or trigger cascade layout effects.

## Unresolved Questions
- None. React 19 lifecycle, `useSyncExternalStore` snapshot contract, and tree-reconciliation rules are clearly specified in official documentation.
