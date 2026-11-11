import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const node = document.getElementById("app");
if (node) {
  createRoot(node).render(<StrictMode><App /></StrictMode>);
}

// Offline shell: lets the home-screen app open instantly and show the last departures without signal.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* optional */ });
  });
}
