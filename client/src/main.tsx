import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply persisted theme (light | medium | dark). Default = light.
function readTheme(): "light" | "medium" | "dark" {
  try {
    const v = localStorage.getItem("chizzle-theme");
    if (v === "light" || v === "medium" || v === "dark") return v;
  } catch {}
  return "light";
}
const theme = readTheme();
document.documentElement.setAttribute("data-theme", theme);
// Legacy: any code path still keying off .dark gets the dark palette only when dark mode is active.
if (theme === "dark") document.documentElement.classList.add("dark");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
