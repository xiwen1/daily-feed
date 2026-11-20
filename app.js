(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem("df:" + k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem("df:" + k, JSON.stringify(v)),
  };
  const AREA_ORDER = ["all", "robotics_embodied", "visual_video_gen", "llm_agent", "rl_decision", "company_news", "other", "starred"];
  const PAGE = 30;

  const S = {
    index: [], day: null, items: [], areas: {},
    area: "all", q: "", sort: "score", togs: new Set(), topic: "",
    shown: 0, filtered: [], cur: -1,
    read: new Set(LS.get("read", [])), stars: LS.get("stars", {}),
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const terms = () => S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  function hl(text) {
    let h = esc(text);
    for (const t of terms()) {
      if (t.length < 2) continue;
      h = h.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")(?![^<]*>)", "gi"), "<mark>$1</mark>");
    }
    return h;
  }
  const fmtTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d)) return "";
    const h = (Date.now() - d) / 36e5;
    if (h < 1) return "刚刚"; if (h < 24) return Math.round(h) + " 小时前"; if (h < 24 * 7) return Math.round(h / 24) + " 天前";
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };
  const toast = (msg) => {
    let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 1400);
  };

  // ---------- theme ----------
  const applyTheme = (t) => { document.documentElement.dataset.theme = t; LS.set("theme", t); };
  applyTheme(LS.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#themeBtn").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

  // ---------- state <-> URL ----------
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    S.area = p.get("area") || "all"; S.q = p.get("q") || ""; S.sort = p.get("sort") || "score";
    S.topic = p.get("topic") || ""; S.togs = new Set((p.get("f") || "").split(",").filter(Boolean));
    return p.get("date");
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (S.day) p.set("date", S.day.date);
    if (S.area !== "all") p.set("area", S.area);
    if (S.q) p.set("q", S.q);
    if (S.sort !== "score") p.set("sort", S.sort);
    if (S.topic) p.set("topic", S.topic);
    if (S.togs.size) p.set("f", [...S.togs].join(","));
    history.replaceState(null, "", "#" + p.toString());
  }

  // ---------- data ----------
  async function loadIndex() {
    const r = await fetch("data/index.json?" + Date.now()); S.index = await r.json();
    $("#dateSel").innerHTML = S.index.map((d) => `<option value="${esc(d.date)}">${esc(d.date.slice(5))} · ${d.papers} 篇</option>`).join("");
  }
  async function loadDay(date) {
    if (!S.index.length) return;
    if (!S.index.some((d) => d.date === date)) date = S.index[0].date;
    const r = await fetch(`data/days/${date}.json`);
    S.day = await r.json(); S.items = S.day.items; S.areas = S.day.areas;
    S.items.forEach((it) => { it._date = S.day.date; });
    $("#dateSel").value = date;
    const i = S.index.findIndex((d) => d.date === date);
    $("#prevDay").disabled = i >= S.index.length - 1; $("#nextDay").disabled = i <= 0;
    $("#genTime").textContent = "· 生成于 " + new Date(S.day.generated).toLocaleString("zh-CN");
    renderHero(); renderChips(); renderTopics(); apply();
  }

  // ---------- hero ----------
  function areaOf(it) { return S.areas[it.areas[0]] || S.areas.other || { color: "#888", short: "" }; }
  function renderHero() {
    const papers = S.items.filter((i) => i.type === "paper");
    const news = S.items.filter((i) => i.type === "news");
    const hf = papers.filter((p) => p.hf).length;
    const d = new Date(S.day.date + "T00:00:00");
    $("#heroTitle").textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 今日精选`;
    $("#heroSub").textContent = `${papers.length} 篇论文（${hf} 篇进入 HF Daily）· ${news.length} 条大厂动态`;
    const picks = [...papers].sort((a, b) => b.score - a.score).slice(0, 8);
    $("#picks").innerHTML = picks.map((p, k) => {
      const a = areaOf(p);
      const th = safeUrl(p.thumb)
        ? `<div class="thumb" style="background-image:url('${esc(p.thumb)}')"><span class="rank">${k + 1}</span></div>`
        : `<div class="thumb ph" style="background:linear-gradient(135deg, ${a.color}, ${a.color}99)"><span class="rank">${k + 1}</span>${esc(p.title.slice(0, 90))}</div>`;
      return `<article class="pick" data-id="${esc(p.id)}">${th}<div class="body">
        <div class="t">${esc(p.zh_title || p.title)}</div><div class="s">${esc(p.zh || p.ai_summary || "")}</div></div></article>`;
    }).join("");
    $$(".pick").forEach((el) => el.onclick = () => jumpTo(el.dataset.id));
  }

  // ---------- chips / topics ----------
  function renderChips() {
    const c = S.day.counts || {};
    const n = { all: S.items.length, starred: Object.keys(S.stars).length, ...c };
    $("#areaChips").innerHTML = AREA_ORDER.filter((k) => k === "all" || k === "starred" || n[k]).map((k) => {
      const m = S.areas[k];
      const label = k === "all" ? "全部" : k === "starred" ? "★ 收藏" : m.short;
      const dot = m ? `<span class="dot" style="background:${m.color}"></span>` : "";
      return `<button class="chip ${S.area === k ? "on" : ""}" data-area="${k}" role="tab">${dot}${label}<span class="n">${n[k] || 0}</span></button>`;
    }).join("");
    $$("#areaChips .chip").forEach((b) => b.onclick = () => { S.area = b.dataset.area; renderChips(); apply(); });
    $$(".tog").forEach((b) => b.classList.toggle("on", S.togs.has(b.dataset.tog)));
    $("#starCount").textContent = Object.keys(S.stars).length;
    $("#starBtn").classList.toggle("on", S.area === "starred");
  }
  function renderTopics() {
    const freq = new Map();
    for (const it of S.items) for (const k of it.keywords || []) {
      const key = k.toLowerCase().trim(); if (key.length < 3) continue; freq.set(key, (freq.get(key) || 0) + 1);
    }
    const top = [...freq].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 60);
    $("#topics").innerHTML = top.length
      ? top.map(([k, v]) => `<button class="topic ${S.topic === k ? "on" : ""}" data-k="${esc(k)}">${esc(k)} <span class="muted">${v}</span></button>`).join("")
      : `<span class="muted small">今日暂无足够的话题标签</span>`;
    $$("#topics .topic").forEach((b) => b.onclick = () => { S.topic = S.topic === b.dataset.k ? "" : b.dataset.k; renderTopics(); apply(); });
  }
  $("#topicsBtn").onclick = () => { const t = $("#topics"); t.hidden = !t.hidden; $("#topicsBtn").classList.toggle("on", !t.hidden); };
  $$(".tog").forEach((b) => b.onclick = () => {
    const k = b.dataset.tog; S.togs.has(k) ? S.togs.delete(k) : S.togs.add(k); b.classList.toggle("on"); apply();
  });

  // ---------- filtering ----------
  function haystack(it) {
    return it._hay ||= [it.title, it.zh_title, it.zh, it.summary, it.ai_summary, (it.authors || []).join(" "), it.org, it.company, (it.keywords || []).join(" "), it.id]
      .filter(Boolean).join(" ").toLowerCase();
  }
  function apply() {
    let xs = S.area === "starred" ? Object.values(S.stars).sort((a, b) => (b._starredAt || 0) - (a._starredAt || 0)) : S.items;
    if (S.area !== "all" && S.area !== "starred") xs = xs.filter((i) => i.areas.includes(S.area));
    const ts = terms();
    if (ts.length) xs = xs.filter((i) => { const h = haystack(i); return ts.every((t) => h.includes(t)); });
    if (S.topic) xs = xs.filter((i) => (i.keywords || []).some((k) => k.toLowerCase().trim() === S.topic));
    if (S.togs.has("code")) xs = xs.filter((i) => i.github);
    if (S.togs.has("project")) xs = xs.filter((i) => i.project);
    if (S.togs.has("hf")) xs = xs.filter((i) => i.hf);
    if (S.togs.has("unread")) xs = xs.filter((i) => !S.read.has(i.id));
    xs = [...xs];
    if (S.sort === "hot") xs.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0) || b.score - a.score);
    else if (S.sort === "new") xs.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
    else if (S.area !== "starred") xs.sort((a, b) => b.score - a.score);
    S.filtered = xs; S.shown = 0; S.cur = -1;
    $("#list").innerHTML = ""; more();
    $("#empty").hidden = xs.length > 0;
    const unread = xs.filter((i) => !S.read.has(i.id)).length;
    $("#resultInfo").textContent = `${xs.length} 条 · 未读 ${unread}`;
    $("#q").value = S.q; $("#sort").value = S.sort;
    renderActive(); writeHash();
  }
  function renderActive() {
    const tags = [];
    if (S.q) tags.push(["q", `搜索：${S.q}`]);
    if (S.topic) tags.push(["topic", `话题：${S.topic}`]);
    $("#activeFilters").innerHTML = tags.map(([k, l]) => `<button class="chip on" data-clear="${k}">${esc(l)} ✕</button>`).join("");
    $$("#activeFilters .chip").forEach((b) => b.onclick = () => { S[b.dataset.clear] = ""; renderTopics(); apply(); });
  }

  // ---------- cards ----------
  function card(it) {
    const isNews = it.type === "news";
    const a = areaOf(it);
    const tags = it.areas.filter((k) => S.areas[k]).map((k) => `<span class="tag" style="background:${S.areas[k].color}">${esc(S.areas[k].short)}</span>`).join("");
    const meta = [
      tags,
      isNews ? `<span class="badge">${esc(it.company)}</span>` : "",
      it.upvotes ? `<span class="badge ${it.upvotes >= 20 ? "hot" : ""}" title="Hugging Face 点赞">▲ ${it.upvotes}</span>` : "",
      it.github ? `<span class="badge">⌨ 代码</span>` : "",
      it.org ? `<span>${esc(it.org)}</span>` : "",
      `<span>${fmtTime(it.published)}</span>`,
      S.area === "starred" && it._date ? `<span>· ${esc(it._date)}</span>` : "",
    ].join("");
    const title = it.zh_title ? `<h3>${hl(it.zh_title)}</h3><div class="en">${hl(it.title)}</div>` : `<h3>${hl(it.title)}</h3>`;
    const one = it.zh || (isNews ? (it.summary || "").slice(0, 140) : it.ai_summary || "");
    const authors = (it.authors || []).join(", ");
    const img = safeUrl(it.thumb || it.image);
    const links = isNews
      ? [["原文", it.link]]
      : [["arXiv", it.link], ["PDF", it.pdf], ["HF", it.hf_link], ["代码", it.github], ["项目页", it.project], ["alphaXiv", `https://www.alphaxiv.org/abs/${it.id}`]];
    const linkHtml = links.filter(([, u]) => safeUrl(u)).map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" data-open>${l}</a>`).join("");
    const kws = (it.keywords || []).map((k) => `<button class="topic" data-k="${esc(k.toLowerCase().trim())}">${esc(k)}</button>`).join("");
    const el = document.createElement("article");
    el.className = `card ${isNews ? "news" : ""} ${S.read.has(it.id) ? "read" : ""}`;
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="main">
        <div class="meta">${meta}</div>
        ${title}
        ${one ? `<p class="zh">${hl(one)}</p>` : ""}
        ${authors ? `<div class="authors">${hl(authors)}</div>` : ""}
      </div>
      <div class="side">
        ${img ? `<div class="cthumb" style="background-image:url('${esc(img)}')" data-img="${esc(img)}"></div>` : ""}
        <div class="acts">
          <button class="act star ${S.stars[it.id] ? "on" : ""}" title="收藏 (s)">${S.stars[it.id] ? "★" : "☆"}</button>
          <button class="act readbtn" title="已读/未读 (x)">${S.read.has(it.id) ? "●" : "○"}</button>
          <button class="act share" title="复制链接">⧉</button>
        </div>
      </div>
      <div class="links">${linkHtml}</div>
      <div class="detail">
        ${it.ai_summary && it.zh ? `<div class="label">HF AI 摘要</div><div>${hl(it.ai_summary)}</div>` : ""}
        ${it.summary ? `<div class="label">${isNews ? "摘要" : "Abstract"}</div><div class="abs">${hl(it.summary)}</div>` : ""}
        ${kws ? `<div class="label">关键词（点击筛选）</div><div class="kws">${kws}</div>` : ""}
        ${it.categories?.length ? `<div class="label">arXiv 分类</div><div class="small muted">${esc(it.categories.join(" · "))}</div>` : ""}
      </div>`;
    $(".main", el).onclick = () => toggleOpen(el, it);
    $(".star", el).onclick = () => toggleStar(it, el);
    $(".readbtn", el).onclick = () => setRead(it, el, !S.read.has(it.id));
    $(".share", el).onclick = () => {
      const u = `${location.origin}${location.pathname}#date=${it._date || S.day.date}&q=${encodeURIComponent(it.id)}`;
      navigator.clipboard?.writeText(`${it.zh_title || it.title}\n${it.link}\n${u}`).then(() => toast("已复制"));
    };
    $$("[data-open]", el).forEach((x) => x.addEventListener("click", () => setRead(it, el, true)));
    $$(".kws .topic", el).forEach((b) => b.onclick = (e) => { e.stopPropagation(); S.topic = b.dataset.k; renderTopics(); apply(); scrollTo({ top: 0, behavior: "smooth" }); });
    const th = $(".cthumb", el); if (th) th.onclick = () => lightbox(th.dataset.img);
    return el;
  }
  function more() {
    const list = $("#list");
    const next = S.filtered.slice(S.shown, S.shown + PAGE);
    let lastDate = S.shown ? S.filtered[S.shown - 1]._date : null;
    for (const it of next) {
      if (S.area === "starred" && it._date !== lastDate) {
        const sep = document.createElement("div"); sep.className = "daysep"; sep.textContent = it._date; list.append(sep); lastDate = it._date;
      }
      list.append(card(it));
    }
    S.shown += next.length;
  }
  new IntersectionObserver((es) => { if (es[0].isIntersecting && S.shown < S.filtered.length) more(); }, { rootMargin: "600px" }).observe($("#sentinel"));

  function toggleOpen(el, it) { el.classList.toggle("open"); if (el.classList.contains("open")) setRead(it, el, true); }
  function setRead(it, el, v) {
    v ? S.read.add(it.id) : S.read.delete(it.id);
    LS.set("read", [...S.read].slice(-8000));
    el.classList.toggle("read", v); $(".readbtn", el).textContent = v ? "●" : "○";
  }
  function toggleStar(it, el) {
    if (S.stars[it.id]) delete S.stars[it.id];
    else { const { _hay, ...rest } = it; S.stars[it.id] = { ...rest, _starredAt: Date.now() }; }
    LS.set("stars", S.stars);
    const on = !!S.stars[it.id]; const b = $(".star", el); b.classList.toggle("on", on); b.textContent = on ? "★" : "☆";
    $("#starCount").textContent = Object.keys(S.stars).length; toast(on ? "已收藏" : "已取消收藏");
    const chipN = $('#areaChips [data-area="starred"] .n'); if (chipN) chipN.textContent = Object.keys(S.stars).length;
  }
  function lightbox(src) {
    const d = document.createElement("div"); d.className = "lightbox"; d.innerHTML = `<img src="${esc(src)}" alt="">`;
    d.onclick = () => d.remove(); document.body.append(d);
  }
  function jumpTo(id) {
    if (!S.filtered.some((i) => i.id === id)) { S.area = "all"; S.q = ""; S.topic = ""; S.togs.clear(); renderChips(); renderTopics(); apply(); }
    const idx = S.filtered.findIndex((i) => i.id === id);
    while (S.shown <= idx) more();
    setCur(idx); const el = curEl(); if (el && !el.classList.contains("open")) toggleOpen(el, S.filtered[idx]);
  }

  // ---------- keyboard ----------
  const curEl = () => $$("#list .card")[S.cur];
  function setCur(i) {
    const cards = $$("#list .card");
    if (i >= cards.length && S.shown < S.filtered.length) { more(); return setCur(i); }
    i = Math.max(0, Math.min(i, $$("#list .card").length - 1));
    cards.forEach((c) => c.classList.remove("cur"));
    S.cur = i; const el = curEl(); if (el) { el.classList.add("cur"); el.scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea")) { if (e.key === "Escape") { e.target.blur(); if (S.q) { S.q = ""; apply(); } } return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const it = S.filtered[S.cur]; const el = curEl();
    switch (e.key) {
      case "j": setCur(S.cur + 1); break;
      case "k": setCur(S.cur - 1); break;
      case "Enter": if (el) toggleOpen(el, it); break;
      case "o": if (it) { open(it.link, "_blank"); setRead(it, el, true); } break;
      case "p": if (it?.pdf) { open(it.pdf, "_blank"); setRead(it, el, true); } break;
      case "s": if (it) toggleStar(it, el); break;
      case "x": if (it) setRead(it, el, !S.read.has(it.id)); break;
      case "/": e.preventDefault(); $("#q").focus(); break;
      case "?": $("#help").showModal(); break;
      case "ArrowLeft": $("#prevDay").click(); break;
      case "ArrowRight": $("#nextDay").click(); break;
      case "Escape": S.q = ""; S.topic = ""; renderTopics(); apply(); break;
      default:
        if (/^[1-8]$/.test(e.key)) { const b = $$("#areaChips .chip")[+e.key - 1]; if (b) b.click(); }
    }
  });

  // ---------- controls ----------
  let qTimer;
  $("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; apply(); }, 160); });
  $("#sort").onchange = (e) => { S.sort = e.target.value; apply(); };
  $("#dateSel").onchange = (e) => loadDay(e.target.value);
  const step = (d) => { const i = S.index.findIndex((x) => x.date === S.day.date) + d; if (S.index[i]) loadDay(S.index[i].date); };
  $("#prevDay").onclick = () => step(1);
  $("#nextDay").onclick = () => step(-1);
  $("#starBtn").onclick = () => { S.area = S.area === "starred" ? "all" : "starred"; renderChips(); apply(); };
  $("#helpBtn").onclick = () => $("#help").showModal();

  // ---------- boot ----------
  (async () => {
    const date = readHash();
    try { await loadIndex(); await loadDay(date || S.index[0]?.date); }
    catch (err) { $("#list").innerHTML = `<div class="empty">数据加载失败：${esc(err.message)}</div>`; }
  })();
})();
