// 打包 small demon 的 Live2D 渲染脚本：
//   node renderer/build-bundle.mjs
// pixi / pixi-live2d-display / esbuild 从 Demon 的 web 目录借用（同一套版本）。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMON_WEB = 'E:/dshwork/dsh-demon/apps/demon/web';
const require = createRequire(path.join(DEMON_WEB, 'package.json'));
const esbuild = require('esbuild');

await esbuild.build({
  entryPoints: [path.join(here, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(here, 'pet', 'bundle.js'),
  nodePaths: [path.join(DEMON_WEB, 'node_modules')],
  logLevel: 'info',
});
