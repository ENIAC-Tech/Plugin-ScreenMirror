import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import path from "node:path";
import url from "node:url";
import json from '@rollup/plugin-json';
import { glob } from 'glob'
const isWatching = !!process.env.ROLLUP_WATCH;
const flexPlugin = "com.eniac.screen_mirror.plugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.js",
	output: {
		file: `${flexPlugin}/backend/plugin.cjs`,
		format: "cjs",
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		},
	},
	plugins: [
		json(),
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${flexPlugin}/manifest.json`);
				const vueFiles = glob.sync(`${flexPlugin}/ui/*.vue`);
                vueFiles.forEach((file) => {
                    this.addWatchFile(file);
                });
			},
		},
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			},
		}
	],
	/**
   * Mark .node files and 'sharp' itself as external so that Rollup doesn't bundle them.
   */
	external: (id) => {
		// Option A: if the dependency name is exactly "sharp" or "screenshot-desktop"
		if (id === "sharp" || id === "screenshot-desktop") {
		  return true;
		}
		// Option B: also treat any .node file path as external
		if (id.endsWith(".node")) {
		  return true;
		}
		return false;
	  },
};

export default config;
