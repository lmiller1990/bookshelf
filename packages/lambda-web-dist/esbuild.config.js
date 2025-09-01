import { build } from "esbuild";

await build({
  entryPoints: ["src/lambda-web.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/lambda-web.js",
  external: ["@aws-sdk/*", "aws-lambda"],
});
