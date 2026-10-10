// Development only: renders the remote standalone, as rmui would for an admin. The admin API calls need
// a running mumblermapi behind the same origin.
import i18next from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";

import MumbleApp from "./App";

void i18next
  .use(initReactI18next)
  .init({ lng: "fi", fallbackLng: "en", resources: {} })
  .then(() =>
    createRoot(document.getElementById("root") as HTMLElement).render(
      <StrictMode>
        <MumbleApp
          data={{
            admin: true,
            voice: true,
            nets: ["/Units/10/101", "/Missions/PATROL-NORTH"],
          }}
        />
      </StrictMode>,
    ),
  );
