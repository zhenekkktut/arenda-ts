import React from "react";
import { createRoot } from "react-dom/client";
import RentalApp from "@/app/rental-app";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("Не найден корневой элемент приложения");

createRoot(root).render(
  <React.StrictMode>
    <RentalApp />
  </React.StrictMode>,
);
