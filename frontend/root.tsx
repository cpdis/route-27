/** Route 27 mobile shell: first paint is styled without JavaScript. */
import { immutableFileUrl } from "https://esm.town/v/std/utils/index.ts";
import * as React from "npm:hono/jsx";

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f7f5" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c1513" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Route 27" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="description" content="Live Transperth Route 27 departure times for Subiaco and Perth CBD." />
        <title>Route 27 · Subiaco ↔ Perth</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="https://esm.town/v/std/catch" />
        <script type="module" src={immutableFileUrl("/frontend/index.tsx")} />
      </head>
      <body>
        <div id="app">
          <div class="route-app">
            <main class="content">
              <div class="topline"><div class="topline-brand"><span class="brand-dot" /> Transperth · Departures</div></div>
              <header class="headline">
                <strong class="route-number">27</strong>
                <div class="headline-copy">
                  <div class="headline-eyebrow">Your bus</div>
                  <h1 class="headline-title">Subiaco ↔ Perth</h1>
                  <p class="headline-subtitle">Route 27</p>
                </div>
              </header>
              <p style="color:var(--muted)">Connecting to Transperth…</p>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
