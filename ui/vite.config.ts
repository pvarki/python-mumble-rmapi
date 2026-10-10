import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// rmui loads `${shortname}-integration/remote-ui` from /ui/mumble/remoteEntry.js and shares these
// singletons with the remote, so the versions follow rmui's.
export default defineConfig({
  // Where the files are served. The federation runtime loads some chunks by absolute path, and on rmui's
  // origin "/assets" belongs to rmui.
  base: "/ui/mumble/",
  build: {
    target: "chrome89",
    rollupOptions: { preserveEntrySignatures: "exports-only" },
  },
  plugins: [
    federation({
      name: "mumble-integration",
      filename: "remoteEntry.js",
      exposes: { "./remote-ui": "./src/App.tsx" },
      shared: {
        react: { requiredVersion: "18.3.1", singleton: true },
        i18next: { requiredVersion: "25.6.2", singleton: true },
        "react-i18next": { requiredVersion: "16.3.3", singleton: true },
      },
      runtime: "@module-federation/enhanced/runtime",
    }),
    react(),
  ],
});
