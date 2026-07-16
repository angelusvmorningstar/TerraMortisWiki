// Smoke test (story 1-1, AC #3): the server boots and serves the home page.
//
// Runner: Node's built-in test runner (`node --test`) with the built-in global
// `fetch` (Node 18+). Chosen over supertest/jest/vitest deliberately — a single
// boot-and-serve smoke test does not justify a third-party test dependency in
// the first story of the repo. Later stories can add supertest if assertion
// ergonomics warrant it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.js';

test('GET / responds 200 with the home page marker text', async () => {
  const app = createApp();
  const server = app.listen(0); // ephemeral port — no clash with a running dev server
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Terra Mortis Wiki/);
    assert.match(body, /css\/theme\.css/); // ported tokens are linked
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
