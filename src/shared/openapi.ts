// The X-Api-Key scheme is optional — the API also serves anonymous callers — so
// each data route advertises "no auth OR ApiKeyAuth". Annotated (not `as`) so the
// empty requirement {} keeps its index-signature type instead of collapsing the union.
export const optionalApiKeySecurity: { [name: string]: string[] }[] = [{}, { ApiKeyAuth: [] }]
