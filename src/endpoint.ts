export interface Parsed { accountId?: string; bucket?: string; region?: string; endpoint?: string; kind: 'r2' | 's3' }

// Reads a pasted endpoint or bucket link and pulls out the account, bucket and region it contains.
//   https://<account>.r2.cloudflarestorage.com/<bucket>      (R2, path style)
//   https://<bucket>.<account>.r2.cloudflarestorage.com      (R2, bucket style)
//   https://<bucket>.s3.<region>.amazonaws.com               (AWS S3)
//   https://s3.<region>.amazonaws.com/<bucket>               (AWS S3, path style)
//   https://minio.example.com:9000/<bucket>                  (any other S3-compatible server)
export function parseEndpoint(raw: string): Parsed | null {
  const t = raw.trim()
  if (!t) return null
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t) } catch { return null }
  const host = u.hostname.toLowerCase()
  const seg = u.pathname.split('/').filter(Boolean)

  const r2 = /^(?:(.+)\.)?([0-9a-f]{32})(\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.exec(host)
  if (r2) {
    return { kind: 'r2', accountId: r2[2], bucket: r2[1] || seg[0], ...(r2[3] ? { endpoint: `https://${r2[2]}${r2[3]}.r2.cloudflarestorage.com` } : {}) }
  }
  const aws = /^(?:(.+)\.)?s3[.-]([a-z0-9-]+)\.amazonaws\.com$/.exec(host)
  if (aws) return { kind: 's3', bucket: aws[1] || seg[0], region: aws[2] === 'external-1' ? 'us-east-1' : aws[2] }
  const awsGlobal = /^(?:(.+)\.)?s3\.amazonaws\.com$/.exec(host)
  if (awsGlobal) return { kind: 's3', bucket: awsGlobal[1] || seg[0], region: 'us-east-1' }
  if (!host.includes('.') && !u.port) return null
  return { kind: 's3', endpoint: u.origin, bucket: seg[0] }
}
