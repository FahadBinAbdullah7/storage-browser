// Bucket names tried automatically when a key cannot list buckets (R2 keys limited to specific
// buckets get "AccessDenied" on ListBuckets). Nothing is hardcoded here: whoever builds the app can
// set the repository secret DEFAULT_BUCKETS (comma separated) and the release workflow writes
// electron/config.local.json from it. Without it the list is empty and users add buckets by name.
let local = {}
try { local = require('./config.local.json') } catch { /* not provided */ }
module.exports = { KNOWN_BUCKETS: Array.isArray(local.buckets) ? local.buckets : [] }
