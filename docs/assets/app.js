/* 页面交互：加载数据、搜索、渲染结果 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const tabsEl = $("#tabs");
  const resultsEl = $("#results");
  const summaryEl = $("#summary");
  const formEl = $("#search-form");
  const inputEl = $("#q");
  const suggestEl = $("#suggest");
  const toastEl = $("#toast");
  const headerEl = $("#header");
  const toTopEl = $("#to-top");

  const PREFIX_LABEL = { S: "S 开头", L: "L 开头", Y: "Y 开头" };
  const EXAMPLES = ["Mate30Pro", "X60Pro", "苹果13", "红米K80", "S01"];
  const FUZZY_LIMIT = 40;
  const SUB_LIMIT = 8;

  const state = {
    index: null,
    boxById: null,
    suggestList: [],
    prefix: "ALL",
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

  function badge(box, small) {
    const size = small ? " badge-sm" : "";
    return `<div class="badge badge-${box.prefix.toLowerCase()}${size}">${esc(box.id)}</div>`;
  }

  function sourceTag(hits) {
    if (!hits.length) return "";
    // “两人已核对”不再展示，只保留“这份型号只有一份表格有”的待核对提示
    const verified = hits.every((h) => h.m.v === "both");
    return verified ? "" : '<span class="tag pending">待核对</span>';
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

  /** 搜索结果里单独列出的“可替代箱号”卡片 */
  function subCard(box, froms) {
    const limited = Math.min(box.models.length, state.expanded.has(box.id) ? 99 : 8);
    const lines = box.models.slice(0, limited).map((m) => {
      const alt = (m.alt || []).length
        ? ` <span class="alt">（另一写法：${esc(m.alt.join("、"))}）</span>`
        : "";
      return `<li>${esc(m.t)}${alt}</li>`;
    }).join("");
    const more = box.models.length > limited
      ? `<button class="more" data-more="${esc(box.id)}" type="button">展开其余 ${box.models.length - limited} 个型号</button>`
      : "";
    const fromText = froms.map((f) => `${esc(f.id)}（${esc(f.name || "未命名箱")}）`).join("、");
    const name = box.name ? esc(box.name) : "未命名箱";
    return `
      <article class="card card-sub" data-id="${esc(box.id)}">
        ${badge(box, false)}
        <div class="card-body">
          <div class="card-head">
            <span class="card-name">${name}</span>
            <span class="tag sub">可替代</span>
          </div>
          <div class="card-sub-note">可以替代 ${fromText}里的机型</div>
          <ul class="hits">${lines}</ul>
          ${more}
          <div class="card-meta">箱号 ${esc(box.id)} · 箱内共 ${box.total} 个型号</div>
        </div>
      </article>`;
  }

  function resultCard(result, tokens) {
    const box = result.box;
    const limited = Math.min(result.hits.length, state.expanded.has(box.id) ? 99 : 8);
    const lines = result.hits.slice(0, limited).map((h) => {
      const cls = h.s >= 96 ? "exact" : "";
      const picked = pickVariant(h.m, tokens);
      const alt = picked.others.length
        ? ` <span class="alt">（另一写法：${esc(picked.others.join("、"))}）</span>`
        : "";
      return `<li class="${cls}">${highlight(picked.text, tokens)}${alt}</li>`;
    }).join("");
    const more = result.hits.length > limited
      ? `<button class="more" data-more="${esc(box.id)}" type="button">展开其余 ${result.hits.length - limited} 个型号</button>`
      : "";
    const name = box.name ? esc(box.name) : "未命名箱";
    return `
      <article class="card" data-id="${esc(box.id)}">
        ${badge(box, false)}
        <div class="card-body">
          <div class="card-head">
            <span class="card-name">${name}</span>
            ${sourceTag(result.hits)}
          </div>
          <ul class="hits">${lines}</ul>
          ${more}
          <div class="card-meta">箱号 ${esc(box.id)} · 箱内共 ${box.total} 个型号</div>
          ${subsHTML(box)}
        </div>
      </article>`;
  }

  function browseCard(box) {
    const preview = box.models.slice(0, 6).map((m) => m.t).join("、");
    const rest = box.models.length > 6 ? " 等" : "";
    const name = box.name ? esc(box.name) : "未命名箱";
    const body = box.models.length
      ? `<div class="card-meta">${esc(preview)}${rest}（共 ${box.total} 个）</div>`
      : '<div class="card-meta">暂无型号数据</div>';
    return `
      <article class="card" data-id="${esc(box.id)}">
        ${badge(box, true)}
        <div class="card-body">
          <div class="card-head"><span class="card-name">${name}</span></div>
          ${body}
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

    // 本次结果里出现的“可替代箱号”：前面的箱子缺货时，可以用它里面的机型顶上
    const subFroms = new Map(); // 可替代箱号 -> [被它替代的箱子…]
    for (const r of exact.concat(shownFuzzy)) {
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
      html += shownFuzzy.map((r) => resultCard(r, tokens)).join("");
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
    const res = window.BoxSearch.suggest(state.suggestList, value, 30);
    if (!res.items.length) {
      closeSuggest();
      return;
    }
    suggestItems = res.items;
    activeIndex = -1;
    const tokens = value.split(/\s+/).filter(Boolean);
    suggestEl.innerHTML = res.items.map((it, i) => {
      const codeList = it.boxes.slice(0, 3).join("·") +
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
    state.result = query ? window.BoxSearch.search(state.index, query) : null;
    render();
    if (updateUrl !== false) {
      const url = new URL(window.location.href);
      if (query) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      history.replaceState(null, "", url);
    }
  }

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

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    inputEl.blur();
    clearTimeout(timer);
    runSearch();
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
    const more = e.target.closest("[data-more]");
    if (more) {
      state.expanded.add(more.dataset.more);
      render();
      return;
    }
    const example = e.target.closest("[data-example]");
    if (example) {
      inputEl.value = example.dataset.example;
      runSearch();
      return;
    }
    const card = e.target.closest(".card");
    if (card) copy(card.dataset.id);
  });

  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    headerEl.classList.toggle("compact", y > 30);
    toTopEl.classList.toggle("show", y > 700);
  }, { passive: true });

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
    state.index = window.BoxSearch.makeIndex(data, subs);
    state.boxById = new Map(state.index.boxes.map((b) => [b.id, b]));
    state.suggestList = window.BoxSearch.buildSuggestions(state.index.boxes);
    buildTabs();
    const initial = new URLSearchParams(location.search).get("q");
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
