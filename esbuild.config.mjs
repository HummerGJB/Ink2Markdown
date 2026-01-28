import esbuild from "esbuild";

const isProduction = process.argv.includes("production");

const buildOptions = {
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  sourcemap: isProduction ? false : "inline",
  minify: isProduction,
  outfile: "main.js"
};

if (isProduction) {
  esbuild.build(buildOptions).catch(() => process.exit(1));
} else {
  esbuild.context(buildOptions).then((context) => context.watch());
}
