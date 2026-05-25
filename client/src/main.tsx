import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Force dark cockpit mode — this is a mission-control surface, no theme toggle.
document.documentElement.classList.add("dark");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
