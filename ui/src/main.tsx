import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles/app.css";
import "./styles/scene.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Fant ikke #root i index.html");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
