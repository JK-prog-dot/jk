// Shared logic for the public lists site. No external dependencies.
(function () {
  "use strict";

  const PAGE_SIZE = 50;
  const cache = {};          // dataset id -> { headers, rows }
  let catalogPromise = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().normalize("NFC").trim(); }
  function label(col) { return col.replace(/_/g, " "); }

  // Minimal RFC 4180 CSV parser (handles quoted commas and line breaks).
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    const headers = (rows.shift() || []).map(h => h.replace(/^﻿/, "").trim());
    return { headers, rows: rows.filter(r => r.some(x => x.trim() !== "")) };
  }

  function catalog() {
    if (!catalogPromise) {
      catalogPromise = fetch("data/catalog.json").then(r => {
        if (!r.ok) throw new Error("catalog " + r.status);
        return r.json();
      });
    }
    return catalogPromise;
  }

  function dataset(id) {
    if (!cache[id]) {
      cache[id] = catalog().then(c => {
        const ds = c.datasets.find(d => d.id === id);
        if (!ds) throw new Error("Unknown list: " + id);
        return fetch(ds.file).then(r => {
          if (!r.ok) throw new Error("Could not load " + ds.file);
          return r.text();
        }).then(t => ({ meta: ds, ...parseCSV(t) }));
      });
    }
    return cache[id];
  }

  function matchesQuery(row, headers, searchCols, tokens) {
    if (!tokens.length) return true;
    const idx = searchCols.map(c => headers.indexOf(c)).filter(i => i >= 0);
    const hay = idx.map(i => norm(row[i])).join(" | ");
    return tokens.every(t => hay.indexOf(t) !== -1);
  }

  function tokenize(q) { return norm(q).split(/\s+/).filter(Boolean); }

  function downloadBlob(filename, text) {
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvLine(cells) {
    return cells.map(v => {
      const s = String(v == null ? "" : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }

  // ---------- Home page ----------
  async function initHome() {
    const c = await catalog();
    const input = $("#global-q");
    const results = $("#results");
    const cards = $("#cards");

    cards.innerHTML = c.datasets.map(d => `
      <a class="card" href="list.html?id=${encodeURIComponent(d.id)}">
        <span class="pill">${esc(d.group)}</span>
        <h3>${esc(d.title)}</h3>
        <p>${esc(d.description)}</p>
        <div class="meta"><span>${d.rows.toLocaleString("en-IN")} rows</span><span>${esc(d.license || "")}</span></div>
      </a>`).join("") + (c.upcoming || []).map(u => `
      <div class="card soon">
        <span class="pill">${esc(u.group)}</span>
        <h3>${esc(u.title)}</h3>
        <p>Not available yet. ${esc(u.reason)}</p>
        <div class="meta"><span>Coming later</span></div>
      </div>`).join("");

    let timer = null, seq = 0;
    async function runSearch() {
      const tokens = tokenize(input.value);
      const my = ++seq;
      if (!tokens.length) { results.innerHTML = ""; return; }
      results.innerHTML = '<p class="lead">Searching…</p>';
      const sets = await Promise.all(c.datasets.map(d => dataset(d.id).catch(() => null)));
      if (my !== seq) return;
      let html = "";
      c.datasets.forEach((d, i) => {
        const set = sets[i];
        if (!set) return;
        const hits = set.rows.filter(r => matchesQuery(r, set.headers, d.search_columns, tokens));
        if (!hits.length) return;
        const shown = hits.slice(0, 5).map(r => {
          const code = r[set.headers.indexOf(d.code_column)] || "";
          const name = r[set.headers.indexOf(d.name_column)] || "";
          return `<li><b>${esc(code)}</b> ${esc(name)}</li>`;
        }).join("");
        html += `<div class="result">
          <h4>${esc(d.title)} · ${hits.length.toLocaleString("en-IN")} match${hits.length === 1 ? "" : "es"}</h4>
          <ul>${shown}</ul>
          <p><a href="list.html?id=${encodeURIComponent(d.id)}&q=${encodeURIComponent(input.value)}">Open all matches in ${esc(d.title)} →</a></p>
        </div>`;
      });
      results.innerHTML = html || '<div class="empty">No match. Try a shorter name, or a code like a pincode or IFSC prefix.</div>';
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 250); });
    const q = new URLSearchParams(location.search).get("q");
    if (q) { input.value = q; runSearch(); }
  }

  // ---------- List page ----------
  async function initList() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const c = await catalog();
    const meta = c.datasets.find(d => d.id === id);
    if (!meta) {
      $("#title").textContent = "List not found";
      $("#intro").innerHTML = 'Go back to the <a href="index.html">home page</a> and pick a list.';
      return;
    }
    const set = await dataset(id);
    const headers = set.headers;
    document.title = meta.title + " · Public Lists";
    $("#title").textContent = meta.title;
    $("#intro").textContent = meta.description;
    $("#info").innerHTML = `<b>${set.rows.length.toLocaleString("en-IN")}</b> rows · Source: ${esc(meta.source || "—")} · License: ${esc(meta.license || "—")}`;
    $("#full-download").href = meta.file;
    $("#full-download").setAttribute("download", id + ".csv");

    const q = $("#q");
    const filtersEl = $("#filters");
    const filterSelects = {};
    (meta.filter_columns || []).forEach(col => {
      const i = headers.indexOf(col);
      if (i < 0) return;
      const values = [...new Set(set.rows.map(r => r[i]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "Filter by " + label(col));
      sel.innerHTML = `<option value="">All ${esc(label(col))}s</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
      sel.dataset.col = col;
      filtersEl.appendChild(sel);
      filterSelects[col] = sel;
    });
    const urlQ = params.get("q");
    if (urlQ) q.value = urlQ;

    let sortCol = null, sortDir = 1, page = 0, filtered = [];
    const thead = $("#thead"), tbody = $("#tbody");
    thead.innerHTML = "<tr>" + headers.map((h, i) => `<th data-i="${i}" scope="col">${esc(label(h))}<span class="arrow"></span></th>`).join("") + "</tr>";

    function apply() {
      const tokens = tokenize(q.value);
      const active = Object.entries(filterSelects).filter(([, s]) => s.value).map(([col, s]) => [headers.indexOf(col), s.value]);
      filtered = set.rows.filter(r => active.every(([i, v]) => r[i] === v) && matchesQuery(r, headers, meta.search_columns, tokens));
      if (sortCol !== null) {
        filtered.sort((a, b) => {
          const x = a[sortCol] || "", y = b[sortCol] || "";
          const nx = Number(x), ny = Number(y);
          const cmp = (!isNaN(nx) && !isNaN(ny) && x !== "" && y !== "") ? nx - ny : x.localeCompare(y, undefined, { numeric: true });
          return cmp * sortDir;
        });
      }
      page = 0;
      render();
    }

    function render() {
      const total = filtered.length;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (page >= pages) page = pages - 1;
      const slice = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      $("#count").textContent = total.toLocaleString("en-IN") + " of " + set.rows.length.toLocaleString("en-IN") + " rows";
      tbody.innerHTML = slice.length ? slice.map(r => "<tr>" + r.map((v, i) => {
        const cls = (v.length > 40) ? "wrap" : (/^\d+$/.test(v) && v.length < 12 ? "num" : "");
        return `<td class="${cls}">${esc(v)}</td>`;
      }).join("") + "</tr>").join("") : `<tr><td class="empty" colspan="${headers.length}">No rows match. Clear the search or filters.</td></tr>`;
      $("#prev").disabled = page === 0;
      $("#next").disabled = page >= pages - 1;
      $("#pageinfo").textContent = `Page ${page + 1} of ${pages}`;
      thead.querySelectorAll("th").forEach(th => {
        const i = +th.dataset.i;
        th.querySelector(".arrow").textContent = i === sortCol ? (sortDir === 1 ? "▲" : "▼") : "";
      });
    }

    thead.addEventListener("click", e => {
      const th = e.target.closest("th");
      if (!th) return;
      const i = +th.dataset.i;
      if (sortCol === i) sortDir = -sortDir; else { sortCol = i; sortDir = 1; }
      apply();
    });
    let t = null;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 180); });
    Object.values(filterSelects).forEach(s => s.addEventListener("change", apply));
    $("#prev").addEventListener("click", () => { page--; render(); });
    $("#next").addEventListener("click", () => { page++; render(); });
    $("#clear").addEventListener("click", () => {
      q.value = ""; Object.values(filterSelects).forEach(s => s.value = ""); sortCol = null; apply();
    });
    $("#dl-filtered").addEventListener("click", () => {
      const lines = [csvLine(headers), ...filtered.map(csvLine)];
      downloadBlob(id + "-filtered.csv", lines.join("\n"));
    });
    apply();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    const fail = (e) => {
      const box = document.getElementById("error");
      if (box) { box.hidden = false; box.textContent = "Could not load the lists. " + e.message; }
      console.error(e);
    };
    (page === "home" ? initHome() : initList()).catch(fail);
  });
})();
