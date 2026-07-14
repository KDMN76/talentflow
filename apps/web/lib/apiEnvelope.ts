/**
 * Gedeelde helpers voor de API-response-envelope.
 *
 * De backend levert responses in drie coëxisterende vormen:
 *   - `{ data: <obj> }`                    → items / CRUD (de-facto standaard)
 *   - `{ data: [], next_cursor|nextCursor }` / `{ data: [], meta }` → lijsten
 *   - een kaal object / `{ message }`      → sommige endpoints
 *
 * Axios unwrapt niets, dus hooks lazen dat inconsistent (`.data` / `.items` /
 * rauw) → lege lijsten en crashes op detailpagina's (envelope-drift). We fixen
 * dat NIET met een globale response-interceptor (die zou `meta.total`,
 * cursor-paginatie en multi-veld-responses slopen en kan `{data}` niet van
 * `{items}` of een kaal object onderscheiden). In plaats daarvan passen we deze
 * kleine helpers gericht toe in de getroffen hooks.
 */

/**
 * Pakt `{ data }` uit. Een kaal object/primitief (geen `data`-sleutel) geeft de
 * payload zelf terug — zo werkt hij zowel voor `{data:obj}` als voor endpoints
 * die het object rechtstreeks retourneren.
 */
export function unwrapData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in (payload as object)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/**
 * Haalt de array uit een lijst-response, tolerant voor álle backend-vormen:
 * `{ data: [] }`, `{ items: [] }`, of een kale array. Retourneert nooit
 * `undefined` (React-Query weigert dat) — bij een onverwachte vorm een lege lijst.
 */
export function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.data)) return p.data as T[];
    if (Array.isArray(p.items)) return p.items as T[];
  }
  return [];
}

/**
 * Leest de paginatie-cursor uit een lijst-response. Tolereert zowel
 * `next_cursor` (snake, meerderheid) als `nextCursor` (camel, sourcing).
 */
export function unwrapCursor(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const c = p.next_cursor ?? p.nextCursor;
    return typeof c === "string" && c ? c : null;
  }
  return null;
}
