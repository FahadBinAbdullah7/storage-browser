const API = 'https://api.cloudflare.com/client/v4'

async function cf(c, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `Bearer ${c.apiToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) {
    throw new Error(json.errors?.[0]?.message || `Cloudflare API error (${res.status})`)
  }
  return json
}

async function databases(c) {
  const j = await cf(c, 'GET', `/accounts/${c.accountId}/d1/database?per_page=100`)
  return j.result.map((d) => ({ id: d.uuid, name: d.name, size: d.file_size, tables: d.num_tables }))
}

async function query(c, dbId, sql, params = []) {
  const j = await cf(c, 'POST', `/accounts/${c.accountId}/d1/database/${dbId}/query`, { sql, params })
  const r = j.result[j.result.length - 1] || {}
  const rows = r.results || []
  return { columns: rows[0] ? Object.keys(rows[0]) : [], rows, meta: r.meta || {} }
}

const q = (n) => '"' + String(n).replace(/"/g, '""') + '"'

async function tables(c, dbId) {
  const r = await query(c, dbId, "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
  return r.rows.map((x) => x.name)
}

async function browse(c, dbId, table, limit, offset) {
  const data = await query(c, dbId, `SELECT * FROM ${q(table)} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`)
  const cnt = await query(c, dbId, `SELECT COUNT(*) AS n FROM ${q(table)}`)
  if (!data.columns.length) {
    const info = await query(c, dbId, `PRAGMA table_info(${q(table)})`)
    data.columns = info.rows.map((x) => x.name)
  }
  return { ...data, total: cnt.rows[0]?.n ?? 0 }
}

module.exports = { databases, query, tables, browse }
