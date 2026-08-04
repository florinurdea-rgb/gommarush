import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GetOffer from "../pages/GetOffer";
import "../index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GetOffer />
  </StrictMode>
);
