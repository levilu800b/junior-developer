import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: false,
    // The backend's first request runs the redaction model, which can take a while
    pageLoadTimeout: 120000,
    responseTimeout: 120000,
    defaultCommandTimeout: 10000,
    video: false,
  },
});
