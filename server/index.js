// Terra Mortis Wiki — thin Express service (story 1-1 skeleton).
// This story only establishes the app skeleton, static CSS, and a placeholder
// home page. Auth, snapshot loading, and real routes arrive in later stories.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Placeholder home page. All colour/font styling flows through the ported
// design tokens in /css/theme.css and the layout in /css/base.css — no inline
// styles, no bare hex (AC #2).
function homePage() {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Terra Mortis Wiki</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cinzel+Decorative:wght@400;700&family=Lato:wght@400;600;700;900&family=Libre+Baskerville:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="/css/base.css">
</head>
<body>
  <main class="page">
    <section class="hero">
      <p class="hero__eyebrow">Vampire: The Requiem 2e</p>
      <h1 class="hero__title">Terra Mortis Wiki</h1>
      <p class="hero__lede">Chronicle companion. This is the placeholder home page for the skeleton build.</p>
    </section>
  </main>
</body>
</html>`;
}

export function createApp() {
  const app = express();

  // Serve ported CSS (and later, other static assets) from public/.
  app.use(express.static(PUBLIC_DIR));

  // Placeholder home page (AC #1).
  app.get('/', (_req, res) => {
    res.type('html').send(homePage());
  });

  return app;
}

// Start listening only when run directly (not when imported by a test).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = process.env.PORT || 3000;
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Terra Mortis Wiki listening on http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use — set PORT to a free port and try again.`);
      process.exit(1);
    }
    throw err;
  });
}
