// Bundles the browser entry, minified, and prints its size and gzip size.
export {};

const result = await Bun.build({
  entrypoints: ["src/browser.ts"],
  target: "browser",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const code = new Uint8Array(await result.outputs[0]!.arrayBuffer());
const gzipped = Bun.gzipSync(code);
console.log(`browser bundle: ${code.length} bytes minified, ${gzipped.length} bytes gzip`);
