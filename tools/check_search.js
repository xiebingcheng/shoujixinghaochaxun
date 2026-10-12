/* 搜索逻辑自测：node tools/check_search.js */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const api = require(path.join(root, "docs", "assets", "search.js"));
const data = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "boxes.json"), "utf8"));
const index = api.makeIndex(data);

function show(query) {
  const started = process.hrtime.bigint();
  const res = api.search(index, query);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const fmt = (list) => list
    .slice(0, 8)
    .map((r) => `${r.box.id}[${r.hits.slice(0, 4).map((h) => h.m.t).join(" / ")}]`)
    .join("  ");
  console.log(`\n查询「${query}」 (${ms.toFixed(1)}ms)`);
  console.log(`  精确 ${res.exact.length}: ${fmt(res.exact)}`);
  console.log(`  相近 ${res.fuzzy.length}: ${fmt(res.fuzzy)}`);
}

["X60Pro", "Mate30Pro", "mate30 pro", "苹果13", "红米K80", "xnote", "荣耀魔法2",
  "华为mate70pro", "三星S20+", "S01", "y07", "折叠屏前屏", "小米10至尊版",
  "vivo Y300Pro", "zzz不存在的型号"].forEach(show);

console.log("\n规范化抽查：");
["小米10至尊版", "小米10至臻版", "荣耀 魔术VS 至臻版", "iPhone17 Air", "Galaxy S20+"]
  .forEach((t) => console.log(`  ${t}  ->  ${api.norm(t)}  |  core=${api.core(t)}`));

// 输入联想
const sugg = api.buildSuggestions(index.boxes);
console.log(`\n联想候选共 ${sugg.length} 条\n`);
["i", "ip", "iphone 11", "红米k8", "mate30", "苹果1", "y30"].forEach((q) => {
  const r = api.suggest(sugg, q, 8);
  console.log(`输入「${q}」 共 ${r.total} 条，前几条：`);
  r.items.forEach((it) => console.log(
    `   ${it.text}${it.alt.length ? "（" + it.alt.join("、") + "）" : ""}  → ${it.boxes.slice(0, 4).join(" ")}${it.boxes.length > 4 ? " 等" : ""}`
  ));
});
