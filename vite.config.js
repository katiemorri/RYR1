import glsl from "vite-plugin-glsl";
import basicSsl from "@vitejs/plugin-basic-ssl";

const isCodeSandbox =
  "SANDBOX_URL" in process.env || "CODESANDBOX_HOST" in process.env;
const isCodespaces =
  "CODESPACES" in process.env ||
  "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN" in process.env;
const useHttps = !isCodespaces;

export default {
  root: "src/",
  publicDir: "../static/",
  base: "./",
  server: {
    host: true,
    open: !isCodeSandbox, // Open if it's not a CodeSandbox
    https: useHttps,
  },
  build: {
    outDir: "../docs",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
  plugins: [glsl(), ...(useHttps ? [basicSsl()] : [])],
};
