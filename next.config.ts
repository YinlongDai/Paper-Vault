import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js runs on the server to read link annotations from PDFs; keep it as a plain Node package
  // (bundling breaks its fake-worker import).
  serverExternalPackages: ["pdfjs-dist"],
  // pdf.js loads its worker with a dynamic import that file tracing can't see; ship it with the route.
  outputFileTracingIncludes: {
    "/api/links": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
