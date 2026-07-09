import { handle } from '@hono/node-server/vercel'
import { app } from './app'

// Requires NODEJS_HELPERS=0 in the Vercel project env: Vercel's Node helpers
// consume the request body stream, so without it any POST that reads its body
// (e.g. /admin/login, /bulk) hangs while @hono/node-server waits for a body
// that was already drained. GET and body-less requests are unaffected.
export default handle(app)
