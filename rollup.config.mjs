import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import path from "node:path";
import url from "node:url";
import json from "@rollup/plugin-json";
import { glob } from "glob";
import copy from "rollup-plugin-copy";
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
      return url.pathToFileURL(
        path.resolve(path.dirname(sourcemapPath), relativeSourcePath)
      ).href;
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
      preferBuiltins: true,
    }),
    commonjs({
      dynamicRequireTargets: [
        'node_modules/sharp/**/*.node',
        'node_modules/sharp/lib/*.js'
      ],
      ignoreDynamicRequires: true
    }),
    !isWatching && terser(),
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({
          fileName: "package.json",
          source: `{ "type": "module" }`,
          type: "asset",
        });
      },
    },
    copy({
      targets: [
        {
          src: "node_modules/screenshot-desktop/lib/win32/screenCapture_1.3.2.bat",
          dest: `${flexPlugin}/backend/`,
        },
        {
          src: "node_modules/screenshot-desktop/lib/win32/app.manifest",
          dest: `${flexPlugin}/backend/`,
        },
      ],
    }),
  ],

};

export default config;