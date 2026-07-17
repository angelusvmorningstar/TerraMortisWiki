// server/db.js — live, read-only Mongo connection module (Story 1.2).
//
// Mirrors the shape of `../TM Suite/server/db.js` (`connectDb`/`getDb`/
// `getCollection`/`closeDb`, idempotent connect), with two deliberate
// differences:
//   1. `ssl=` handling uses `stripSslParam` (split-on-`?` / filter / rejoin),
//      NOT TM Suite's `[&?]ssl=[^&]*` regex — that regex consumes a leading `?`
//      and corrupts the URI when `ssl` is the FIRST query param (the post-review
//      fix carried forward from the retired snapshot script).
//   2. This is the ONLY thing in the deployed service that touches Mongo, and
//      only ever READ-ONLY. There is no write path anywhere in this module — the
//      hardened lexical guard test in mongo-store.test.js re-applies here.
//
// Read-only is enforced by BOTH: (a) this code issues zero write calls [tested],
// and (b) the Atlas DB user this connects as is provisioned with a read-only
// role — a MANUAL Atlas-console step (see README), the real enforcement layer;
// the client cannot enforce it from its side.
//
// Connection lifecycle: a long-lived Express process connects ONCE at boot
// (server/index.js `start()`), keeps the connection open for the process
// lifetime, and closes gracefully on SIGTERM/SIGINT (Render sends SIGTERM on
// deploys/restarts). `connectDb()` is idempotent so re-entry is a no-op.

import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client = null;
let db = null;

// Splits a Mongo connection string's query string and drops any `ssl=` param,
// regardless of its position — unlike a `[&?]ssl=[^&]*` regex, this can't
// consume a leading `?` and corrupt the URI when `ssl` is the first param.
// (MongoDB driver v7 rejects the legacy `ssl=` param; `tls: true` is passed via
// the client options below instead.) The match is case-insensitive: MongoDB
// connection-string option keys are case-insensitive, and the driver rejects
// the `ssl` option whatever its case, so `SSL=`/`Ssl=` must be stripped too or
// connectDb would throw at boot.
export function stripSslParam(uri) {
  const qIndex = uri.indexOf('?');
  if (qIndex === -1) return uri;
  const base = uri.slice(0, qIndex);
  const params = uri.slice(qIndex + 1).split('&').filter((p) => !/^ssl=/i.test(p));
  return params.length ? `${base}?${params.join('&')}` : base;
}

// Connect once and cache. Idempotent: a second call while already connected is a
// no-op (test suites and any accidental double-boot share the one connection).
export async function connectDb() {
  if (db) return db;
  const uri = stripSslParam(config.MONGODB_URI);
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    tls: true,
  });
  await client.connect();
  db = client.db(config.MONGODB_DB);
  console.log('MongoDB connected (read-only)');
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not connected — call connectDb() first');
  return db;
}

export function getCollection(name) {
  return getDb().collection(name);
}

export function isConnected() {
  try {
    return !!db;
  } catch {
    return false;
  }
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}

// Test-only seam (Story 1.2 AC #5): inject a fake `Db` (a mock of the mongodb
// driver boundary — a plain object exposing `.collection(name)` that returns a
// fake `Collection`) so the automated suite returns canned documents and NEVER
// touches the live `tm_suite` database. Pass `null` to reset between test files.
export function setTestDb(fake) {
  db = fake;
}
