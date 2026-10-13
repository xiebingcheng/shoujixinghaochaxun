/* 页面交互：加载数据、搜索、渲染结果 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const modesEl = $("#modes");
  const tabsEl = $("#tabs");
  const resultsEl = $("#results");
  const summaryEl = $("#summary");
  const formEl = $("#search-form");
  const inputEl = $("#q");
  const suggestEl = $("#suggest");
  const toastEl = $("#toast");
  const headerEl = $("#header");
  const toTopEl = $("#to-top");
  const subEl = $(".app-sub");

  const PREFIX_LABEL = { S: "S 开头", L: "L 开头", Y: "Y 开头" };
  const EXAMPLES = ["Mate30Pro", "X60Pro", "苹果13", "红米K80", "S01"];
  const FUZZY_LIMIT = 40;
  const SUB_LIMIT = 8;
  const SIZE_MATCH_LIMIT = 40;
  const SIZE_NEAR = 0.05;    // 差 ≤ 0.05 英寸算「尺寸一致」
  const SIZE_CLOSE = 0.15;   // 差 ≤ 0.15 英寸算「尺寸接近」
  const SIZE_MAX = 0.30;     // 差 > 0.30 英寸就不列出来
  const PLACEHOLDER = {
    model: "手机型号或箱号，如 Mate30Pro、S01",
    size: "手机型号或屏幕尺寸，如 红米10A、6.5",
  };
  const SUB_TITLE = {
    model: "输入手机型号或箱号，查出所在箱子",
    size: "按屏幕尺寸找箱号：输型号或直接输尺寸，如 6.5",
  };

  const state = {
    index: null,
    boxById: null,
    sizes: null,
    suggestList: [],
    prefix: "ALL",
    mode: "model",
    result: null,
    expanded: new Set(),
  };

  let suggestItems = [];
  let activeIndex = -1;

  // ------------------------------------------------------------ 工具函数
  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  /** 在原始文本里高亮查询词（忽略空格大小写差异） */
  function highlight(raw, tokens) {
    const compact = [];
    let plain = "";
    for (let i = 0; i < raw.length; i += 1) {
      if (/\s/.test(raw[i])) continue;
      plain += raw[i].toLowerCase();
      compact.push(i);
    }
    const list = (tokens || []).slice().sort((a, b) => b.length - a.length);
    for (const token of list) {
      const t = token.toLowerCase().replace(/\s+/g, "");
      if (t.length < 2) continue;
      const pos = plain.indexOf(t);
      if (pos < 0) continue;
      const start = compact[pos];
      const end = compact[pos + t.length - 1] + 1;
      return esc(raw.slice(0, start)) + "<mark>" + esc(raw.slice(start, end)) + "</mark>" + esc(raw.slice(end));
    }
    return esc(raw);
  }

  let toastTimer = 0;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  function copy(text) {
    const done = () => toast("已复制箱号 " + text);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，箱号：" + text); }
      document.body.removeChild(ta);
    }
  }

  // ------------------------------------------------------------ 渲染
  function containsToken(text, tokens) {
    const compact = String(text).toLowerCase().replace(/\s+/g, "");
    return (tokens || []).some((t) => {
      const tk = t.toLowerCase().replace(/\s+/g, "");
      return tk.length >= 2 && compact.includes(tk);
    });
  }

  /** 型号可能有多种写法，优先显示与用户输入一致的那种 */
  function pickVariant(model, tokens) {
    const all = [model.t].concat(model.alt || []);
    const hit = all.find((t) => containsToken(t, tokens));
    const text = hit || model.t;
    return { text, others: all.filter((t) => t !== text) };
  }

  /** 6.50 -> 6.5，6.53 -> 6.53 */
  function fmtInch(n) {
    return Number(n).toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  }

  /** 箱号上只保留 1 位小数：6.47 -> 6.5，避免标签太长看不清楚 */
  function oneInch(n) {
    return (Math.round(Number(n) * 10) / 10).toFixed(1);
  }

  /** 箱号右上角的屏幕尺寸标签；没有可靠尺寸时不显示 */
  function sizeChip(box) {
    const info = state.sizes && state.sizes.boxes && state.sizes.boxes[box.id];
    if (!info || !info.ok || !info.inch) return "";
    const fold = info.inner && info.outer;
    let lines;
    let title;
    if (fold) {
      lines = [`内 ${oneInch(info.inner)}″`, `外 ${oneInch(info.outer)}″`];
      title = `折叠屏：内屏约 ${oneInch(info.inner)}″，外屏约 ${oneInch(info.outer)}″`;
    } else {
      const [lo, hi] = info.range || [];
      const wide = hi !== undefined && Math.round(hi * 10) - Math.round(lo * 10) >= 2;
      const text = wide ? `${oneInch(lo)}-${oneInch(hi)}″` : `${oneInch(info.inch)}″`;
      lines = [text];
      title = `这一箱的屏幕约 ${text}（按箱内 ${info.known}/${info.total} 个型号统计）`;
    }
    const body = lines.map((t) => `<span class="sz-line">${esc(t)}</span>`).join("");
    return `<span class="badge-size${fold ? " badge-size-2" : ""}" title="${esc(title)}">${body}</span>`;
  }

  /** small：浏览列表里的小号徽标；toggle：箱号变成可点开的按钮 */
  function badge(box, small, toggle) {
    const size = small ? " badge-sm" : "";
    const cls = `badge badge-${box.prefix.toLowerCase()}${size}`;
    const chip = sizeChip(box);
    if (!toggle) return `<div class="${cls}">${esc(box.id)}${chip}</div>`;
    const open = state.expanded.has(box.id);
    return `<button class="${cls} badge-btn" type="button" data-toggle="${esc(box.id)}" ` +
      `aria-expanded="${open}" aria-label="展开 ${esc(box.id)} 箱内的机型" ` +
      `title="点开查看 ${esc(box.id)} 箱里的机型">${esc(box.id)}${chip}</button>`;
  }

  /** 卡片底部：左边一句说明，右边「收起 / 复制箱号」按钮 */
  function footHTML(box, meta, showCollapse) {
    const text = meta === undefined ? `箱号 ${esc(box.id)} · 箱内共 ${box.total} 个型号` : meta;
    const collapse = showCollapse && state.expanded.has(box.id)
      ? `<button class="more" data-more="${esc(box.id)}" type="button">收起</button>`
      : "";
    return `<div class="card-foot${text ? "" : " foot-end"}">` +
      (text ? `<span class="card-meta">${text}</span>` : "") +
      '<span class="foot-actions">' + collapse +
      `<button class="copy-btn" type="button" data-copy="${esc(box.id)}" ` +
      `title="复制箱号 ${esc(box.id)}">复制箱号</button></span>` +
      "</div>";
  }

  function toggleBox(id) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    render();
  }

  function sourceTag(hits) {
    if (!hits.length) return "";
    // 数据核对标签不再展示给客户（2026-10-12 起）
    return "";
  }

  /** 本箱缺货时可以拿来替代的箱号（数据来自 data/substitutes.json） */
  function subsHTML(box) {
    const subs = box.subs || [];
    if (!subs.length) return "";
    const links = subs.map((id) => {
      const target = state.boxById && state.boxById.get(id);
      const name = target && target.name ? esc(target.name) : "";
      const title = name ? `${id} ${target.name}` : id;
      return `<button class="sub-link" type="button" data-sub="${esc(id)}" title="${esc(title)}">` +
        `<span class="sub-id">${esc(id)}</span>` +
        (name ? `<span class="sub-name">${name}</span>` : "") +
        "</button>";
    }).join("");
    return '<div class="subs">' +
      '<span class="subs-label" title="本箱缺货时，可以用这些箱号里的机型替代">可替代箱号</span>' +
      links +
      "</div>";
  }

  /** 搜索结果里单独列出的“可替代箱号”卡片（froms = 它可以替代的那几个箱子） */
  function subCard(box, froms) {
    const open = state.expanded.has(box.id);
    const limited = Math.min(box.models.length, open ? 999 : 8);
    const lines = box.models.slice(0, limited).map((m) => {
      const alt = (m.alt || []).length
        ? ` <span class="alt">（另一写法：${esc(m.alt.join("、"))}）</span>`
        : "";
      return `<li>${esc(m.t)}${alt}</li>`;
    }).join("");
    let more = "";
    if (open && box.models.length > 8) {
      more = `<button class="more" data-more="${esc(box.id)}" type="button">收起</button>`;
    } else if (box.models.length > limited) {
      more = `<button class="more" data-more="${esc(box.id)}" type="button">展开其余 ${box.models.length - limited} 个型号</button>`;
    }
    const fromText = froms.map((f) =>
      `<button class="sub-link" type="button" data-sub="${esc(f.id)}" title="查看 ${esc(f.id)}">${esc(f.id)}</button>` +
      `（${esc(f.name || "未命名箱")}）`
    ).join("、");
    const name = box.name ? esc(box.name) : "未命名箱";
    return `
      <article class="card card-sub${open ? " card-open" : ""}" data-id="${esc(box.id)}">
        ${badge(box, false, true)}
        <div class="card-body">
          <div class="card-head">
            <span class="card-name">${name}</span>
            <span class="tag sub">可替代</span>
          </div>
          <div class="card-sub-note">${fromText}缺货时，可以用本箱里的机型替代</div>
          <ul class="hits">${lines}</ul>
          ${more}
          ${footHTML(box, undefined, limited > 12 && !more)}
        </div>
      </article>`;
  }

  function resultCard(result, tokens, withSubs) {
    const box = result.box;
    const open = state.expanded.has(box.id);
    const limited = Math.min(result.hits.length, open ? 999 : 8);
    const lines = result.hits.slice(0, limited).map((h) => {
      const cls = h.s >= 96 ? "exact" : "";
      const picked = pickVariant(h.m, tokens);
      const alt = picked.others.length
        ? ` <span class="alt">（另一写法：${esc(picked.others.join("、"))}）</span>`
        : "";
      return `<li class="${cls}">${highlight(picked.text, tokens)}${alt}</li>`;
    }).join("");
    // 展开时把箱子里没命中的型号也一起列出来，方便看清整箱内容
    const hitModels = new Set(result.hits.map((h) => h.m));
    const rest = open ? box.models.filter((m) => !hitModels.has(m)) : [];
    const restHTML = rest.length
      ? '<li class="rest-label">箱内其余型号</li>' + rest.map((m) => {
        const alt = (m.alt || []).length
          ? ` <span class="alt">（另一写法：${esc(m.alt.join("、"))}）</span>`
          : "";
        return `<li class="rest">${esc(m.t)}${alt}</li>`;
      }).join("")
      : "";
    const shownCount = limited + rest.length;
    let more = "";
    if (open && result.hits.length > 8) {
      more = `<button class="more" data-more="${esc(box.id)}" type="button">收起</button>`;
    } else if (result.hits.length > limited) {
      more = `<button class="more" data-more="${esc(box.id)}" type="button">展开其余 ${result.hits.length - limited} 个命中型号</button>`;
    }
    const name = box.name ? esc(box.name) : "未命名箱";
    return `
      <article class="card${open ? " card-open" : ""}" data-id="${esc(box.id)}">
        ${badge(box, false, true)}
        <div class="card-body">
          <div class="card-head">
            <span class="card-name">${name}</span>
            ${sourceTag(result.hits)}
          </div>
          <ul class="hits">${lines}${restHTML}</ul>
          ${more}
          ${footHTML(box, undefined, shownCount > 12 && !more)}
          ${withSubs === false ? "" : subsHTML(box)}
        </div>
      </article>`;
  }

  function browseCard(box) {
    const open = state.expanded.has(box.id);
    const name = box.name ? esc(box.name) : "未命名箱";
    let body;
    let foot;
    if (!box.models.length) {
      body = '<div class="card-meta">暂无型号数据</div>';
      foot = footHTML(box, "");
    } else if (open) {
      body = '<ul class="hits">' + box.models.map((m) => {
        const alt = (m.alt || []).length
          ? ` <span class="alt">（另一写法：${esc(m.alt.join("、"))}）</span>`
          : "";
        return `<li>${esc(m.t)}${alt}</li>`;
      }).join("") + "</ul>";
      foot = footHTML(box, undefined, box.models.length > 12);
    } else {
      const preview = box.models.slice(0, 6).map((m) => esc(m.t)).join("、");
      const rest = box.models.length > 6 ? " 等" : "";
      body = `<div class="card-meta">${preview}${rest}（共 ${box.total} 个）</div>`;
      foot = footHTML(box, "点箱号展开箱内机型");
    }
    return `
      <article class="card${open ? " card-open" : ""}" data-id="${esc(box.id)}">
        ${badge(box, true, true)}
        <div class="card-body">
          <div class="card-head"><span class="card-name">${name}</span></div>
          ${body}
          ${foot}
          ${subsHTML(box)}
        </div>
      </article>`;
  }

  function visibleBoxes(list) {
    return state.prefix === "ALL" ? list : list.filter((b) => b.box.prefix === state.prefix);
  }

  function renderBrowse() {
    const boxes = state.index.boxes;
    const list = boxes.filter((b) => state.prefix === "ALL" || b.prefix === state.prefix);
    summaryEl.innerHTML = `共 <b>${boxes.length}</b> 个箱号 · ` +
      `S ${boxes.filter((b) => b.prefix === "S").length} / ` +
      `L ${boxes.filter((b) => b.prefix === "L").length} / ` +
      `Y ${boxes.filter((b) => b.prefix === "Y").length}`;
    let html = "";
    const groups = state.prefix === "ALL" ? ["S", "L", "Y"] : [state.prefix];
    for (const p of groups) {
      const items = list.filter((b) => b.prefix === p);
      if (!items.length) continue;
      html += `<h2 class="group-title">${PREFIX_LABEL[p]}（${items.length} 个箱号）</h2>`;
      html += items.map(browseCard).join("");
    }
    resultsEl.innerHTML = html;
  }

  // ------------------------------------------------------- 尺寸查箱号（按屏幕尺寸找箱号）
  /** 输入像 6.5 / 6.5寸 / 6.5英寸 就当成尺寸；否则当成型号 */
  function parseSizeQuery(text) {
    const s = String(text).trim().replace(/英寸|寸|"|″/g, "").trim();
    if (!/^\d(?:\.\d{1,2})?$/.test(s)) return null;
    const n = parseFloat(s);
    return n >= 4 && n <= 9 ? n : null;
  }

  function modelSize(key) {
    if (!state.sizes || !state.sizes.models) return null;
    const v = state.sizes.models[key];
    if (typeof v === "number") return v;
    // 折叠屏取内屏当代表尺寸（外屏在尺寸查询里单独参与匹配）
    if (v && typeof v === "object" && typeof v.inner === "number") return v.inner;
    return null;
  }

  /** 一个型号的所有屏幕尺寸：单屏 1 条，折叠屏内屏 + 外屏 2 条 */
  function modelSizes(key) {
    const v = state.sizes && state.sizes.models && state.sizes.models[key];
    if (typeof v === "number") return [{ inch: v, kind: "single" }];
    if (v && typeof v === "object") {
      const out = [];
      if (typeof v.inner === "number") out.push({ inch: v.inner, kind: "inner" });
      if (typeof v.outer === "number") out.push({ inch: v.outer, kind: "outer" });
      return out;
    }
    return [];
  }

  /** 型号的尺寸文字：普通机型「6.5″」，折叠屏「内7.8/外6.3″」 */
  function sizesLabel(key) {
    const list = modelSizes(key);
    if (!list.length) return "";
    if (list.length === 1) return `${fmtInch(list[0].inch)}″`;
    return list.map((s) => (s.kind === "inner" ? "内" : "外") + fmtInch(s.inch)).join("/") + "″";
  }

  /**
   * 查一个型号的屏幕尺寸：先精确查表，查不到就复用搜索的模糊/别名匹配兜底
   * （尺寸表里存的是「华为P40」，用户只输「P40」时也要能查到）。
   * 返回 { size, model }：model 是兜底时匹配到的机型名，精确命中时为 null。
   */
  function resolveSize(raw) {
    const direct = modelSize(window.BoxSearch.norm(raw));
    if (direct !== null) return { size: direct, model: null };
    const res = window.BoxSearch.search(state.index, raw);
    let best = null;
    for (const [pool, penalty] of [[res.exact, 0], [res.fuzzy, 1000]]) {
      for (const r of pool) {
        for (const h of r.hits) {
          const s = modelSize(h.m.k);
          if (s === null) continue;
          const rank = h.s - penalty;
          if (!best || rank > best.rank) best = { rank, size: s, model: h.m.t };
        }
      }
    }
    return best;
  }

  /** 尺寸模式下所有箱号里出现过的尺寸档（用于快捷入口） */
  function quickSizes() {
    const boxes = (state.sizes && state.sizes.boxes) || {};
    const uniq = new Set();
    for (const id of Object.keys(boxes)) {
      const e = boxes[id];
      if (e.ok && e.inch) uniq.add(Math.round(e.inch * 10) / 10);
    }
    return Array.from(uniq).sort((a, b) => a - b);
  }

  function sizeExamplesHTML() {
    const btns = quickSizes().slice(0, 8).map((s) =>
      `<button class="example" type="button" data-size="${s.toFixed(1)}">${esc(oneInch(s))}″</button>`
    ).join("");
    const models = ["红米10A", "苹果13"].map((e) =>
      `<button class="example" type="button" data-example="${esc(e)}">${esc(e)}</button>`
    ).join("");
    return btns + models;
  }

  function sizeEmptyHTML(title, hint) {
    return `
      <div class="empty">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14"/></svg>
        <p>${esc(title)}</p>
        <p class="hint">${esc(hint)}</p>
        <div class="examples">${sizeExamplesHTML()}</div>
      </div>`;
  }

  function sizeLevel(d) {
    if (d <= SIZE_NEAR) return { key: "same", label: "尺寸一致" };
    if (d <= SIZE_CLOSE) return { key: "close", label: "尺寸接近" };
    return { key: "fit", label: "勉强候选" };
  }

  /** 每个箱子里「离目标尺寸最近」的那块屏（折叠屏会分别比内屏和外屏） */
  function nearestBySize(size) {
    const list = [];
    for (const box of state.index.boxes) {
      if (state.prefix !== "ALL" && box.prefix !== state.prefix) continue;
      let best = null;
      for (const m of box.models) {
        for (const s of modelSizes(m.k)) {
          const d = Math.abs(s.inch - size);
          if (!best || d < best.d) best = { model: m, inch: s.inch, kind: s.kind, d };
        }
      }
      if (best && best.d <= SIZE_MAX) list.push(Object.assign({ box }, best));
    }
    list.sort((a, b) => a.d - b.d || (a.box.id < b.box.id ? -1 : 1));
    return list;
  }

  function sizeCard(item) {
    const box = item.box;
    const open = state.expanded.has(box.id);
    const level = sizeLevel(item.d);
    const name = box.name ? esc(box.name) : "未命名箱";
    const diff = item.d < 0.005 ? "尺寸相同" : `差 ${fmtInch(item.d)}″`;
    const kindText = item.kind === "inner" ? "内屏 " : item.kind === "outer" ? "外屏 " : "";
    const kindTag = item.kind === "single" ? ""
      : `<span class="tag kind-${item.kind}">${item.kind === "inner" ? "内屏匹配" : "外屏匹配"}</span>`;
    const closest = '<div class="size-hit">箱内最接近：<b>' + esc(item.model.t) + "</b> · " +
      esc(kindText + fmtInch(item.inch)) + '″<span class="size-diff">' + esc(diff) + "</span></div>";
    const body = open
      ? '<ul class="hits">' + box.models.map((m) => {
        const label = sizesLabel(m.k);
        const tag = label ? ` <span class="size-tag">${esc(label)}</span>` : "";
        const alt = (m.alt || []).length
          ? ` <span class="alt">（另一写法：${esc(m.alt.join("、"))}）</span>`
          : "";
        return `<li>${esc(m.t)}${tag}${alt}</li>`;
      }).join("") + "</ul>"
      : closest;
    return `
      <article class="card card-size${open ? " card-open" : ""}" data-id="${esc(box.id)}">
        ${badge(box, true, true)}
        <div class="card-body">
          <div class="card-head">
            <span class="card-name">${name}</span>
            <span class="tag size-${level.key}">${level.label}</span>
            ${kindTag}
          </div>
          ${body}
          ${footHTML(box, open ? undefined : "点箱号展开箱内机型", open && box.models.length > 12)}
        </div>
      </article>`;
  }

  function renderSizeIntro() {
    const boxes = (state.sizes && state.sizes.boxes) || {};
    const ids = Object.keys(boxes).filter((id) => boxes[id].ok && boxes[id].inch);
    summaryEl.innerHTML = state.sizes
      ? `已标出屏幕尺寸的箱号：<b>${ids.length}</b> / ${state.index.boxes.length} 个`
      : "尺寸数据加载失败，暂时只能用「型号查箱号」";
    resultsEl.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14"/></svg>
        <p>输手机型号，或直接输屏幕尺寸</p>
        <p class="hint">输型号（如 <b>红米10A</b>）会先查它的屏幕尺寸，再列出尺寸相近的箱号；
          也可以直接输 <b>6.5</b>。箱号右上角就是这一箱的屏幕尺寸。</p>
        <div class="examples">${sizeExamplesHTML()}</div>
      </div>`;
  }

  function renderSizeSearch() {
    const raw = inputEl.value.trim();
    if (!raw) {
      renderSizeIntro();
      return;
    }
    let size = parseSizeQuery(raw);
    let head;
    if (size === null) {
      const hit = resolveSize(raw);
      if (!hit) {
        summaryEl.innerHTML = `没有「${esc(raw)}」的屏幕尺寸数据`;
        resultsEl.innerHTML = sizeEmptyHTML(
          "查不到这个型号的屏幕尺寸",
          "换种写法再试（如 红米10A、苹果13），或直接输尺寸，如 6.5"
        );
        return;
      }
      size = hit.size;
      head = hit.model
        ? `「${esc(raw)}」匹配到「${esc(hit.model)}」，屏幕约 <b>${esc(fmtInch(size))}″</b>`
        : `「${esc(raw)}」屏幕约 <b>${esc(fmtInch(size))}″</b>`;
    } else {
      head = `屏幕尺寸 <b>${esc(fmtInch(size))}″</b>`;
    }

    const list = nearestBySize(size);
    if (!list.length) {
      summaryEl.innerHTML = head + "，没找到尺寸相近的箱号";
      resultsEl.innerHTML = sizeEmptyHTML(
        "没有尺寸相近的箱号",
        "换个尺寸再试，比如 6.1、6.5、6.7；或换个型号写法"
      );
      return;
    }
    const same = list.filter((x) => x.d <= SIZE_NEAR);
    const close = list.filter((x) => x.d > SIZE_NEAR && x.d <= SIZE_CLOSE);
    const fit = list.filter((x) => x.d > SIZE_CLOSE);
    const groups = [
      ["尺寸一致", same, SIZE_MATCH_LIMIT],
      ["尺寸接近", close, SIZE_MATCH_LIMIT],
      ["勉强候选（差得较多，需现场比对）", fit, 10],
    ];
    summaryEl.innerHTML = head + `，找到 <b>${list.length}</b> 个尺寸相近的箱号` +
      `（一致 ${same.length} / 接近 ${close.length} / 勉强 ${fit.length}）`;

    let html = '<p class="notice">屏幕尺寸相近 ≠ 可以通用。请现场比对屏幕尺寸、比例、排线、开孔后再决定。</p>';
    for (const [title, items, limit] of groups) {
      if (!items.length) continue;
      const shownItems = items.slice(0, limit);
      html += `<h2 class="group-title">${title}（${items.length}）</h2>`;
      html += shownItems.map(sizeCard).join("");
      if (items.length > shownItems.length) {
        html += `<p class="list-note">这一组还有 ${items.length - shownItems.length} 个，` +
          `把尺寸写得更接近一点可以缩小范围。</p>`;
      }
    }
    resultsEl.innerHTML = html;
  }

  function renderSearch() {
    const res = state.result;
    const tokens = String(inputEl.value).trim().split(/\s+/).filter(Boolean);
    if (res.q.length < 2) {
      summaryEl.textContent = "继续输入型号或箱号…";
      resultsEl.innerHTML = emptyHTML("从上方的下拉列表选择机型", "继续输入会自动列出匹配的机型，也可以直接输入箱号，如 S01");
      return;
    }
    let exact = visibleBoxes(res.exact);
    let fuzzy = visibleBoxes(res.fuzzy);

    if (!exact.length && !fuzzy.length) {
      summaryEl.innerHTML = `查询「${esc(inputEl.value.trim())}」没有结果`;
      resultsEl.innerHTML = emptyHTML("没找到这个型号", "换个写法试试，比如只输入型号主体（X60Pro、Mate30Pro）");
      return;
    }

    const shownFuzzy = fuzzy.slice(0, FUZZY_LIMIT);

    // “可替代箱号”只跟着「精确匹配」走：用户搜的型号确实在这个箱里，才说明它缺货时能用谁顶。
    // 相近结果不带替代箱号，避免用户以为那个箱子能替代自己查的箱号。
    const subFroms = new Map(); // 可替代箱号 -> [被它替代的箱子…]
    for (const r of exact) {
      for (const id of r.box.subs || []) {
        const list = subFroms.get(id) || [];
        if (!list.includes(r.box)) list.push(r.box);
        subFroms.set(id, list);
      }
    }
    const subBoxes = Array.from(subFroms.keys())
      .map((id) => state.boxById && state.boxById.get(id))
      .filter(Boolean);
    const shownSubs = subBoxes.slice(0, SUB_LIMIT);

    let summary = exact.length
      ? `找到 <b>${exact.length}</b> 个箱号包含「${esc(res.query.trim())}」` +
        (fuzzy.length ? `，另有 <b>${fuzzy.length}</b> 个相近结果` : "")
      : `没有完全匹配，以下是 <b>${fuzzy.length}</b> 个相近结果`;
    if (subBoxes.length) summary += `，可替代箱号 <b>${subBoxes.length}</b> 个`;
    summaryEl.innerHTML = summary;

    let html = "";
    if (exact.length) {
      html += `<h2 class="group-title">精确匹配（${exact.length}）</h2>`;
      html += exact.map((r) => resultCard(r, tokens)).join("");
    }
    if (shownSubs.length) {
      html += `<h2 class="group-title">可替代箱号（${shownSubs.length}）</h2>`;
      html += shownSubs.map((b) => subCard(b, subFroms.get(b.id))).join("");
      if (subBoxes.length > shownSubs.length) {
        html += `<p class="list-note">还有 ${subBoxes.length - shownSubs.length} 个可替代箱号，` +
          `把型号写完整一点就能看到。</p>`;
      }
    }
    if (fuzzy.length) {
      html += `<h2 class="group-title">相近结果（${fuzzy.length}）</h2>`;
      html += shownFuzzy.map((r) => resultCard(r, tokens, false)).join("");
      if (fuzzy.length > shownFuzzy.length) {
        html += `<p class="list-note">相近结果较多，只显示前 ${shownFuzzy.length} 个，` +
          `再补充几个字符可以缩小范围。</p>`;
      }
    }
    resultsEl.innerHTML = html;
  }

  function emptyHTML(title, hint) {
    return `
      <div class="empty">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14"/></svg>
        <p>${esc(title)}</p>
        <p class="hint">${esc(hint)}</p>
        <div class="examples">
          ${EXAMPLES.map((e) => `<button class="example" type="button" data-example="${esc(e)}">${esc(e)}</button>`).join("")}
        </div>
      </div>`;
  }

  function render() {
    if (!state.index) return;
    if (state.mode === "size") {
      renderSizeSearch();
      return;
    }
    if (state.result) renderSearch();
    else renderBrowse();
  }

  // ------------------------------------------------------------ 输入联想
  function closeSuggest() {
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
    suggestItems = [];
    activeIndex = -1;
  }

  function renderSuggest() {
    const value = inputEl.value.trim();
    if (!state.index || !value) {
      closeSuggest();
      return;
    }
    // 尺寸模式下输的是「6.5」这类尺寸，不需要机型联想
    if (state.mode === "size" && parseSizeQuery(value) !== null) {
      closeSuggest();
      return;
    }
    const res = window.BoxSearch.suggest(state.suggestList, value, 30);
    if (!res.items.length) {
      closeSuggest();
      return;
    }
    suggestItems = res.items;
    activeIndex = -1;
    const tokens = value.split(/\s+/).filter(Boolean);
    suggestEl.innerHTML = res.items.map((it, i) => {
      const sizeLabel = state.mode === "size" ? sizesLabel(it.id) : "";
      const codeList = sizeLabel || it.boxes.slice(0, 3).join("·") +
        (it.boxes.length > 3 ? ` 等${it.boxes.length}` : "");
      const alt = it.alt.length ? ` <span class="alt">（${esc(it.alt.join("、"))}）</span>` : "";
      const tag = it.type === "name" ? '<span class="s-tag">箱名</span>' : "";
      return `<div class="s-item" role="option" data-i="${i}">` +
        `<span class="s-text">${highlight(it.text, tokens)}${tag}${alt}</span>` +
        `<span class="s-boxes">${esc(codeList)}</span></div>`;
    }).join("") +
      (res.total > res.items.length
        ? `<div class="s-more">还有 ${res.total - res.items.length} 条匹配，继续输入可缩小范围</div>`
        : "");
    suggestEl.hidden = false;
  }

  function selectSuggest(index) {
    const item = suggestItems[index];
    if (!item) return;
    inputEl.value = item.text;
    closeSuggest();
    clearTimeout(timer);
    runSearch();
    inputEl.blur();
  }

  // ------------------------------------------------------------ 交互
  let timer = 0;
  function runSearch(updateUrl) {
    const query = inputEl.value.trim();
    state.expanded.clear();
    state.result = state.mode === "model" && query
      ? window.BoxSearch.search(state.index, query)
      : null;
    render();
    if (updateUrl !== false) {
      const url = new URL(window.location.href);
      if (query) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      if (state.mode === "size") url.searchParams.set("mode", "size");
      else url.searchParams.delete("mode");
      history.replaceState(null, "", url);
    }
  }

  /** 切换「型号查箱号 / 尺寸查箱号」 */
  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    state.expanded.clear();
    for (const b of modesEl.querySelectorAll(".mode")) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    }
    inputEl.placeholder = PLACEHOLDER[mode];
    if (subEl) subEl.textContent = SUB_TITLE[mode];
    closeSuggest();
    runSearch();
  }

  modesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode");
    if (btn) setMode(btn.dataset.mode);
  });

  inputEl.addEventListener("input", () => {
    renderSuggest();
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(), 120);
  });

  inputEl.addEventListener("focus", () => {
    if (inputEl.value.trim()) renderSuggest();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (suggestEl.hidden) {
      if (e.key === "ArrowDown" && inputEl.value.trim()) {
        e.preventDefault();
        renderSuggest();
      }
      return;
    }
    const items = suggestEl.querySelectorAll(".s-item");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      activeIndex = Math.min(Math.max(activeIndex + delta, -1), items.length - 1);
      items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
      if (activeIndex >= 0) items[activeIndex].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        selectSuggest(activeIndex);
      } else {
        closeSuggest();
      }
      return;
    }
    if (e.key === "Escape") closeSuggest();
  });

  suggestEl.addEventListener("mousedown", (e) => e.preventDefault());
  suggestEl.addEventListener("click", (e) => {
    const item = e.target.closest(".s-item");
    if (item) selectSuggest(Number(item.dataset.i));
  });

  document.addEventListener("click", (e) => {
    if (!formEl.contains(e.target)) closeSuggest();
  });

  /** 立即查询：收起联想下拉 → 收键盘 → 马上搜（下拉不能挡在结果上面） */
  let lastSubmit = 0;
  function submitNow() {
    const now = Date.now();
    if (now - lastSubmit < 300) return;   // 同一次点按可能触发两遍，第二次忽略
    lastSubmit = now;
    closeSuggest();
    inputEl.blur();
    clearTimeout(timer);
    runSearch();
  }

  // 手机上点放大镜时，有的浏览器第一次点按只会先收起键盘、不派发 click/submit，
  // 于是下拉框留在原地。这里改成按下手指就查一次（后面真来了 click/submit 会被去重挡掉）。
  const searchBtn = $(".search-btn");
  if (window.PointerEvent) searchBtn.addEventListener("pointerdown", submitNow);
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    submitNow();
  });

  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    state.prefix = btn.dataset.prefix;
    for (const t of tabsEl.querySelectorAll(".tab")) {
      t.setAttribute("aria-pressed", String(t === btn));
    }
    render();
  });

  resultsEl.addEventListener("click", (e) => {
    const sub = e.target.closest("[data-sub]");
    if (sub) {
      inputEl.value = sub.dataset.sub;
      closeSuggest();
      clearTimeout(timer);
      runSearch();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      copy(copyBtn.dataset.copy);
      return;
    }
    const more = e.target.closest("[data-more]");
    if (more) {
      toggleBox(more.dataset.more);
      return;
    }
    const example = e.target.closest("[data-example]");
    if (example) {
      inputEl.value = example.dataset.example;
      runSearch();
      return;
    }
    const sizeBtn = e.target.closest("[data-size]");
    if (sizeBtn) {
      inputEl.value = sizeBtn.dataset.size;
      closeSuggest();
      runSearch();
      return;
    }
    // 点箱号（或卡片空白处）展开 / 收起，看到箱号里到底有哪些机型
    const card = e.target.closest(".card");
    if (card && card.dataset.id) toggleBox(card.dataset.id);
  });

  /** 量出「展开态」头部有多高，给页面留同样多的上边距（收起时不再改变文档高度） */
  function syncHeaderSpace() {
    const compact = headerEl.classList.contains("compact");
    headerEl.classList.remove("compact");
    const h = Math.round(headerEl.getBoundingClientRect().height);
    if (compact) headerEl.classList.add("compact");
    document.documentElement.style.setProperty("--header-space", h + "px");
  }

  // 头部折叠：阈值特意留了回差（下滚 >60 收起、回到 <20 展开），
  // 而且收起只让头部自己变矮、文档高度不变，所以不会被滚动锚定拽回去。
  let headerCompact = false;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (!headerCompact && y > 60) headerCompact = true;
    else if (headerCompact && y < 20) headerCompact = false;
    headerEl.classList.toggle("compact", headerCompact);
    toTopEl.classList.toggle("show", y > 700);
  }, { passive: true });

  // 屏幕旋转、窗口尺寸变化、字体加载完都可能让头部变高变矮，重量一次即可
  window.addEventListener("resize", syncHeaderSpace);
  window.addEventListener("orientationchange", () => setTimeout(syncHeaderSpace, 200));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderSpace);
  syncHeaderSpace();  // 先按「标签栏还没建好」的头部量一次，数据到了会再量一次

  toTopEl.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  // ------------------------------------------------------------ 启动
  function buildTabs() {
    const counts = { ALL: state.index.boxes.length };
    for (const b of state.index.boxes) counts[b.prefix] = (counts[b.prefix] || 0) + 1;
    const defs = [
      ["ALL", "全部"],
      ["S", "S 开头"],
      ["L", "L 开头"],
      ["Y", "Y 开头"],
    ];
    tabsEl.innerHTML = defs.map(([key, label]) =>
      `<button class="tab" type="button" data-prefix="${key}" aria-pressed="${key === state.prefix}">` +
      `${label}<span style="opacity:.65"> ${counts[key] || 0}</span></button>`
    ).join("");
  }

  async function boot() {
    resultsEl.innerHTML = '<div class="loading">正在加载型号数据…</div>';
    let data;
    try {
      const resp = await fetch("data/boxes.json", { cache: "no-cache" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      data = await resp.json();
    } catch (err) {
      resultsEl.innerHTML = emptyHTML(
        "数据加载失败",
        "请通过 http(s) 地址打开本页面（本地预览可运行 python -m http.server）"
      );
      if (location.protocol !== "https:" && location.protocol !== "http:") {
        resultsEl.innerHTML = emptyHTML(
          "请用网页地址打开",
          "直接双击文件（file://）无法读取数据，请在文件夹里运行 python -m http.server 后访问"
        );
      }
      return;
    }
    // 箱号替代关系是单独一个文件，缺失时整站照常可用
    let subs = null;
    try {
      const subResp = await fetch("data/substitutes.json", { cache: "no-cache" });
      if (subResp.ok) subs = await subResp.json();
      else console.warn("替代关系数据加载失败：HTTP " + subResp.status);
    } catch (err) {
      console.warn("替代关系数据加载失败，跳过", err);
    }
    // 屏幕尺寸数据也是单独一个文件，缺失时整站照常可用（只是箱号不标尺寸）
    try {
      const szResp = await fetch("data/sizes.json", { cache: "no-cache" });
      if (szResp.ok) state.sizes = await szResp.json();
      else console.warn("屏幕尺寸数据加载失败：HTTP " + szResp.status);
    } catch (err) {
      console.warn("屏幕尺寸数据加载失败，跳过", err);
    }
    state.index = window.BoxSearch.makeIndex(data, subs);
    state.boxById = new Map(state.index.boxes.map((b) => [b.id, b]));
    state.suggestList = window.BoxSearch.buildSuggestions(state.index.boxes);
    buildTabs();
    // 标签栏建好之后头部才是最终高度，这时量一次留白
    syncHeaderSpace();
    const params = new URLSearchParams(location.search);
    state.mode = params.get("mode") === "size" ? "size" : "model";
    for (const b of modesEl.querySelectorAll(".mode")) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
    }
    inputEl.placeholder = PLACEHOLDER[state.mode];
    if (subEl) subEl.textContent = SUB_TITLE[state.mode];
    const initial = params.get("q");
    if (initial) inputEl.value = initial;
    runSearch(false);
    const c = state.index.counts;
    if (c && c.boxes) {
      $("#gen").textContent = `数据更新于 ${state.index.generatedAt}，共 ${c.boxes} 个箱号 / ${c.models} 条型号记录`;
    }
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  boot();
})();
