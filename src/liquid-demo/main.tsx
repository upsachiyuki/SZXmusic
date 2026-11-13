import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./demo.css";
import { LiquidDemoApp } from "./LiquidDemoApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LiquidDemoApp />
  </StrictMode>
);
