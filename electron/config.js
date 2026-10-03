// Bucket names tried automatically when a key cannot list buckets (R2 keys limited to
// specific buckets get "AccessDenied" on ListBuckets). Only names the key can actually
// open are shown. Add your own bucket names here.
module.exports = { KNOWN_BUCKETS: ['10ms-videos', '10mscdn', '10ms-vidoes'] }
