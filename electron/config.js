// Optional bucket names tried automatically when a key cannot list buckets (R2 keys limited
// to specific buckets get "AccessDenied" on ListBuckets). Normally leave this empty: names you
// type on the connection, or open once by name, are remembered per connection.
module.exports = { KNOWN_BUCKETS: [] }
