/* 把网页版用到的数据同步成小程序能直接 require 的模块，并复制搜索逻辑，
   保证网页版和小程序版只有一份数据 / 一份搜索实现的来源。

   用法：node tools/build_mp_data.js
   什么时候跑：① 第一次准备小程序；② 每次改完 docs/data 里的数据之后。

   为什么要把数据打进小程序包：
   小程序的网络请求域名必须是 HTTPS + 已 ICP 备案 + 在微信后台配置过白名单，
   GitHub Pages（github.io）满足不了。这份数据是纯静态的、体积也小（<200KB），
   直接放进代码包最省事，还顺带离线可用。 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const docsData = path.join(root, "docs", "data");
const mpDir = path.join(root, "miniprogram");
const mpData = path.join(mpDir, "data");
const mpUtils = path.join(mpDir, "utils");

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeModule(file, value) {
  const head = "/* 本文件由 tools/build_mp_data.js 自动生成，请勿手改；" +
    "改数据请编辑 docs/data/ 里的 JSON 后重新运行该脚本。 */\n";
  fs.writeFileSync(file, head + "module.exports = " + JSON.stringify(value) + ";\n", "utf8");
}

function kb(file) {
  return (fs.statSync(file).size / 1024).toFixed(0) + " KB";
}

fs.mkdirSync(mpData, { recursive: true });
fs.mkdirSync(mpUtils, { recursive: true });

const boxesSrc = path.join(docsData, "boxes.json");
const subsSrc = path.join(docsData, "substitutes.json");
const sizesSrc = path.join(docsData, "sizes.json");
if (!fs.existsSync(boxesSrc)) {
  console.error("找不到 " + boxesSrc + "，请先运行 python tools/build_data.py");
  process.exit(1);
}

const outBoxes = path.join(mpData, "boxes.js");
const outSubs = path.join(mpData, "substitutes.js");
const outSizes = path.join(mpData, "sizes.js");
writeModule(outBoxes, readJSON(boxesSrc));
writeModule(outSubs, fs.existsSync(subsSrc) ? readJSON(subsSrc) : { pairs: [] });
// 屏幕尺寸数据（含每个箱号的代表尺寸），缺失时小程序自动降级成「只有型号查箱号」
writeModule(outSizes, fs.existsSync(sizesSrc)
  ? readJSON(sizesSrc)
  : { generatedAt: "", thresholds: {}, stats: {}, models: {}, boxes: {} });

// 搜索逻辑统一来源：直接复制网页版的 search.js（CommonJS 写法两边都能用）
const searchSrc = path.join(root, "docs", "assets", "search.js");
const searchOut = path.join(mpUtils, "search.js");
fs.copyFileSync(searchSrc, searchOut);

console.log("✓ miniprogram/data/boxes.js        " + kb(outBoxes));
console.log("✓ miniprogram/data/substitutes.js  " + kb(outSubs));
console.log("✓ miniprogram/data/sizes.js        " + kb(outSizes));
console.log("✓ miniprogram/utils/search.js      " + kb(searchOut));
console.log("小程序代码包里的数据合计 " +
  (((fs.statSync(outBoxes).size + fs.statSync(outSubs).size +
     fs.statSync(outSizes).size) / 1024).toFixed(0)) +
  " KB，远低于主包 2MB 上限，无需联网、无需备案域名。");
