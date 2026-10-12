/* 搜索核心逻辑：规范化、型号匹配、打分排序。
   同时可在 Node 中 require 以便自动化测试。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoxSearch = api;
})(typeof self !== "undefined" ? self : this, function () {
  // 与 tools/build_data.py 中的映射保持一致
  const ALIASES = [
    ["华为", "huawei"],
    ["荣耀", "honor"],
    ["小米", "xiaomi"],
    ["红米", "redmi"],
    ["苹果", "iphone"],
    ["真我", "realme"],
    ["一加", "oneplus"],
    ["三星", "samsung"],
    ["魅族", "meizu"],
    ["魔术", "magic"],
    ["魔法", "magic"],
    ["魔幻", "magic"],
    ["保时捷版", "rs"],
    ["保时捷设计", "rs"],
    ["至臻版", "ultimate"],
    ["至尊版", "ultimate"],
    ["至臻", "ultimate"],
    ["至尊", "ultimate"],
    ["尊享版", "ultimate"],
    ["青春版", "youth"],
    ["活力版", "youth"],
    ["国内版", "cn"],
    ["超声波解锁", ""],
    ["厚胶", ""],
  ];

  const SEP_RE = /[\s,，、;；/／|｜\\\-—_~～:：.。'’"“”()（）\[\]【】{}｛｝]+/g;

  const BRAND_PREFIXES = [
    "huawei", "honor", "xiaomi", "redmi", "vivo", "oppo", "oneplus", "realme",
    "iphone", "apple", "samsung", "galaxy", "iqoo", "meizu", "tdtech",
    "金利", "优畅享", "麦芒", "联想", "中兴", "努比亚", "摩托罗拉", "诺基亚",
    "海信", "飞利浦", "索尼", "夏普", "黑鲨", "红魔", "魅蓝", "锤子", "美图",
    "中国移动", "移动", "联通", "电信", "酷派", "天语", "小辣椒", "朵唯",
    "letv", "leeco", "htc", "zte", "nubia", "lenovo", "motorola", "nokia",
    "philips", "sharp", "sony", "blackshark", "smartisan", "gionee", "doov",
    "hisense", "tcl", "meitu", "vertu", "8848", "docomo", "softbank",
  ];

  const PREFIX_ORDER = { S: 0, L: 1, Y: 2 };

  function norm(text) {
    let s = String(text == null ? "" : text).normalize("NFKC").toLowerCase();
    s = s.replace(/＋|﹢/g, "+");
    for (const [a, b] of ALIASES) s = s.split(a).join(b);
    s = s.replace(SEP_RE, "");
    return s.split("+").join("plus");
  }

  function core(text) {
    let s = norm(text);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of BRAND_PREFIXES) {
        if (s.startsWith(p) && s.length > p.length + 1) {
          s = s.slice(p.length);
          changed = true;
          break;
        }
      }
    }
    return s;
  }

  /** 预计算索引：给每个箱号补上规范化字段 */
  function makeIndex(data) {
    const boxes = data.boxes.map((box) => ({
      id: box.id,
      prefix: box.prefix,
      name: box.name || "",
      nk: norm(box.name || ""),
      nc: core(box.name || ""),
      idKey: box.id.toLowerCase(),
      total: box.models.length,
      models: box.models.map((m) => ({
        t: m.t,
        alt: m.alt || [],
        k: m.k || norm(m.t),
        c: m.c || core(m.t),
        v: m.v || "d",
      })),
    }));
    boxes.sort(
      (a, b) =>
        (PREFIX_ORDER[a.prefix] ?? 9) - (PREFIX_ORDER[b.prefix] ?? 9) ||
        codeNum(a.id) - codeNum(b.id)
    );
    return { boxes, counts: data.counts || {}, generatedAt: data.generatedAt || "" };
  }

  function codeNum(id) {
    const n = parseInt(String(id).replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /** 单条文本的匹配分：100 完全相同 / 96 型号核心相同 / 82 前缀 / 64 包含 / 58 被包含 */
  function score(key, coreKey, q, qc) {
    if (!q || !key) return 0;
    if (key === q) return 100;
    // 核心型号只在“够长且含字母”时才用于匹配，避免"13"这类纯数字误伤一大片
    const useCore = qc.length >= 3 && /[a-z]/.test(qc);
    if (useCore && coreKey === qc) return 96;
    if (key.startsWith(q) || (useCore && coreKey.startsWith(qc))) return 82;
    if (key.includes(q) || (useCore && coreKey.includes(qc))) return 64;
    if (key.length >= 3 && q.includes(key)) return 58;
    return 0;
  }

  /**
   * 查询。
   * 返回 { q, exact: [...], fuzzy: [...] }，每个结果 { box, score, hits, byId, byName }
   */
  function search(index, rawQuery) {
    const q = norm(rawQuery);
    const qc = core(rawQuery);
    if (!q) return { q, exact: [], fuzzy: [], query: rawQuery };
    const allowFuzzy = q.length >= 2;
    const exact = [];
    const fuzzy = [];

    for (const box of index.boxes) {
      const idScore = q === box.idKey ? 100 : 0;
      const nameScore = score(box.nk, box.nc, q, qc);
      const hits = [];
      let modelBest = 0;
      for (const m of box.models) {
        const s = score(m.k, m.c, q, qc);
        if (s >= 58) hits.push({ m, s });
        if (s > modelBest) modelBest = s;
      }
      hits.sort((a, b) => b.s - a.s || a.m.t.length - b.m.t.length);
      const best = Math.max(idScore, nameScore, modelBest);
      if (!best) continue;

      const byId = idScore === 100;
      const byName = nameScore >= 82;
      let list = hits;
      if (!list.length && box.total) {
        // 命中箱号或箱子名称时，展示箱内型号作为参考
        list = box.models.slice(0, 12).map((m) => ({ m, s: 0 }));
      }
      const result = { box, score: best, hits: list, byId, byName };
      if (best >= 96) exact.push(result);
      else if (allowFuzzy) fuzzy.push(result);
    }

    const sorter = (a, b) => b.score - a.score || b.hits.length - a.hits.length;
    exact.sort(sorter);
    fuzzy.sort(sorter);
    return { q, query: rawQuery, exact, fuzzy };
  }

  return { norm, core, makeIndex, search, score, PREFIX_ORDER };
});
