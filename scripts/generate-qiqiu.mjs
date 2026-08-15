#!/usr/bin/env node
// 奇趣网站收藏家 —— 资源页生成器
// 读取 GitHub Issue 正文与评论 → 提取「奇趣网站 / 软件资源」→ 生成独立静态页 curious-websites.html
// 风格与 iBitBetter (ibitbetter.space) 站点一致：暖色编辑风（奶油底 + 赤陶橙主色），明暗主题自适应。
// 零依赖，运行在 Node 18+（使用内置 fetch）。
//
// 评论 / 正文资源格式（每行一个）：
//   - [名称](https://example.com) 一句话描述 | #标签1 #标签2
// 可选：在评论顶部用 HTML 注释声明分类
//   <!-- category: 设计工具 -->
//
// 用法：
//   node scripts/generate-qiqiu.mjs                 # 从 GitHub Issue 生成（需 GITHUB_REPOSITORY + GH_TOKEN）
//   node scripts/generate-qiqiu.mjs --demo          # 用内置示例数据生成预览
//   node scripts/generate-qiqiu.mjs --local 种子.md  # 用本地 markdown 作为 Issue 正文生成预览（不联网）

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DEMO = process.argv.includes("--demo") || process.env.DEMO === "1";
const localIdx = process.argv.indexOf("--local");
const LOCAL_FILE = localIdx > -1 ? process.argv[localIdx + 1] : null;

// ---------- 配置 ----------
async function loadConfig() {
  let fileConfig = {};
  try {
    const raw = await readFile(join(ROOT, "config.json"), "utf8");
    fileConfig = JSON.parse(raw);
  } catch {
    // 没有 config.json 也没关系，走默认值
  }
  const cfg = {
    repository: process.env.GITHUB_REPOSITORY || fileConfig.repository || "",
    issueNumber: Number(process.env.ISSUE_NUMBER || fileConfig.issueNumber || 1),
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
    outputPath: process.env.OUTPUT_PATH || fileConfig.outputPath || "curious-websites.html",
    pageTitle: process.env.PAGE_TITLE || fileConfig.pageTitle || "奇趣网站收藏家",
    siteTitle: process.env.SITE_TITLE || fileConfig.siteTitle || "iBitBetter",
    siteUrl: process.env.SITE_URL || fileConfig.siteUrl || "https://ibitbetter.space",
    sourceIssueUrl: "",
  };
  cfg.sourceIssueUrl = `https://github.com/${cfg.repository}/issues/${cfg.issueNumber}`;
  return cfg;
}

// ---------- GitHub API ----------
async function githubFetch(url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "qiqiu-collector-generator",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} ${res.url}: ${text.slice(0, 200)}`);
  }
  return res;
}

async function fetchIssue(cfg) {
  const url = `https://api.github.com/repos/${cfg.repository}/issues/${cfg.issueNumber}`;
  const res = await githubFetch(url, cfg.token);
  return res.json();
}

async function fetchComments(cfg) {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = `https://api.github.com/repos/${cfg.repository}/issues/${cfg.issueNumber}/comments?per_page=${perPage}&page=${page}`;
    const res = await githubFetch(url, cfg.token);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

// ---------- 解析 ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* ignore */
  }
  return null;
}

function parseBlock(body, category) {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const items = [];
  let currentCategory = category;
  for (const line of lines) {
    // 可选分类声明：<!-- category: xxx -->
    const catMatch = line.match(/^\s*<!--\s*category:\s*(.+?)\s*-->\s*$/i);
    if (catMatch) {
      currentCategory = catMatch[1].trim();
      continue;
    }
    // 标准格式：- [名称](url) 描述 | #标签
    const md = line.match(/^\s*[-*]\s*\[(.*?)\]\((.*?)\)\s*(.*)$/);
    if (md) {
      const title = md[1].trim();
      const url = md[2].trim();
      let rest = md[3].trim();
      const { desc, tags } = splitTags(rest);
      pushItem(items, title, url, desc, tags, currentCategory);
      continue;
    }
    // 兼容：裸链接 - https://example.com 描述 | #标签
    const bare = line.match(/^\s*[-*]\s*(https?:\/\/\S+)\s*(.*)$/);
    if (bare) {
      const url = bare[1].trim();
      let rest = bare[2].trim();
      const { desc, tags } = splitTags(rest);
      const title = desc || url;
      pushItem(items, title, url, desc, tags, currentCategory);
    }
  }
  return items;
}

function splitTags(rest) {
  const idx = rest.lastIndexOf("|");
  if (idx === -1) return { desc: rest.trim(), tags: [] };
  const after = rest.slice(idx + 1);
  const tagMatches = after.match(/#([^\s#,]+)/g);
  const tags = tagMatches ? tagMatches.map((t) => t.slice(1).trim()) : [];
  return { desc: rest.slice(0, idx).trim(), tags };
}

function pushItem(items, title, url, desc, tags, category) {
  const safe = safeUrl(url);
  if (!title || !safe) return; // 跳过无效条目（防 XSS / 坏链接）
  items.push({
    title: title.slice(0, 120),
    url: safe,
    desc: desc.slice(0, 300),
    tags,
    category: category || "",
  });
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// ---------- 渲染（iBitBetter 暖色编辑风） ----------
function renderCards(items) {
  return items
    .map((it) => {
      const tagsHtml = it.tags
        .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
        .join("");
      const catHtml = it.category
        ? `<span class="cat">${escapeHtml(it.category)}</span>`
        : "";
      return `      <article class="card" data-title="${escapeHtml(
        it.title.toLowerCase()
      )}" data-desc="${escapeHtml(it.desc.toLowerCase())}" data-tags="${escapeHtml(
        it.tags.join(" ").toLowerCase()
      )}">
        <a class="card-title" href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        it.title
      )}</a>
        ${it.desc ? `<p class="card-desc">${escapeHtml(it.desc)}</p>` : ""}
        <div class="card-meta">${catHtml}${tagsHtml}</div>
      </article>`;
    })
    .join("\n");
}

function renderTagBar(tags) {
  if (tags.length === 0) return "";
  const chips = tags
    .map(
      (t) =>
        `<button class="chip" type="button" data-tag="${escapeHtml(
          t.toLowerCase()
        )}">#${escapeHtml(t)}</button>`
    )
    .join("");
  return `<div class="chips" id="chips"><button class="chip active" type="button" data-tag="">全部</button>${chips}</div>`;
}

function buildHtml(cfg, items, generatedAt) {
  const allTags = [...new Set(items.flatMap((i) => i.tags))].sort((a, b) =>
    a.localeCompare(b, "zh")
  );
  const count = items.length;
  const cards = renderCards(items);
  const tagBar = renderTagBar(allTags);
  const safeTitle = escapeHtml(cfg.pageTitle);
  const safeSite = escapeHtml(cfg.siteTitle);
  const safeIssue = escapeHtml(cfg.sourceIssueUrl);
  const safeTime = escapeHtml(generatedAt);
  const canonical = cfg.siteUrl
    ? `${cfg.siteUrl.replace(/\/$/, "")}/${cfg.outputPath}`
    : "";
  const canonicalTag = canonical
    ? `<link rel="canonical" href="${escapeHtml(canonical)}" />`
    : "";
  const avatar = cfg.siteUrl
    ? `${cfg.siteUrl.replace(/\/$/, "")}/assets/ibitbetter.webp`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>${safeTitle} | ${safeSite}</title>
<meta name="description" content="${safeTitle} —— iBitBetter 精选的奇趣网站与效率工具收藏，由 GitHub Issue 评论自动整理更新。" />
<meta property="og:title" content="${safeTitle} | ${safeSite}" />
<meta property="og:description" content="iBitBetter 精选的奇趣网站与效率工具收藏，由 GitHub Issue 评论自动整理更新。" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
${canonicalTag}
<script>
  let theme = localStorage.getItem("meek_theme") || "light";
  document.documentElement.setAttribute("data-color-mode", theme);
</script>
<style>
  :root {
    --bg: #FBF6EE;
    --surface: #FFFFFF;
    --text: #2E2A24;
    --muted: #8A7F70;
    --accent: #E2613B;
    --accent-soft: #FBEDE6;
    --accent2: #C98A3B;
    --line: #EFE6D8;
    --radius: 14px;
    --shadow: 0 1px 3px rgba(46,42,36,.06), 0 8px 24px rgba(46,42,36,.05);
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
  }
  [data-color-mode="dark"] {
    --bg: #1E1A16;
    --surface: #26211B;
    --text: #F3E9DD;
    --muted: #B6A892;
    --accent: #F0916A;
    --accent-soft: #3A2C22;
    --accent2: #E0A85C;
    --line: #3A322A;
    --shadow: 0 6px 20px rgba(0,0,0,.35);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: var(--font); line-height: 1.65; font-size: 16px;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* —— 顶部导航（与站点一致） —— */
  .site-header {
    display: flex; align-items: center; gap: 12px;
    max-width: 980px; margin: 0 auto; padding: 22px 20px 14px;
    border-bottom: 1px solid var(--line);
  }
  .site-header .avatar {
    width: 52px; height: 52px; border-radius: 50%; object-fit: cover;
    transition: transform .6s; flex: none;
  }
  .site-header .avatar:hover { transform: rotate(360deg); }
  .site-header .brand {
    font-family: Monaco, "PingFang SC", monospace; font-size: 28px; font-weight: 700;
    color: var(--text); letter-spacing: -.02em;
  }
  .site-header .nav { margin-left: auto; display: flex; gap: 8px; }
  .site-header .nav a {
    color: var(--muted); padding: 8px 12px; border-radius: 999px; font-size: .9rem;
    border: 1px solid transparent;
  }
  .site-header .nav a:hover { color: var(--text); background: var(--accent-soft); text-decoration: none; }

  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 64px; }
  header.page-head h1 {
    font-size: clamp(1.8rem, 4.5vw, 2.6rem); margin: 0 0 6px; letter-spacing: -.02em;
  }
  header.page-head .sub { color: var(--muted); margin: 0; font-size: .98rem; }
  header.page-head .intro {
    color: var(--text); opacity: .85; margin: 14px 0 0; font-size: .95rem;
    background: var(--accent-soft); border-left: 3px solid var(--accent);
    padding: 12px 16px; border-radius: 10px;
  }
  .toolbar { position: sticky; top: 0; z-index: 5; background: var(--bg); padding: 18px 0 10px; }
  .search {
    width: 100%; padding: 12px 16px; font-size: 1rem; color: var(--text);
    background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
    outline: none; transition: border-color .15s, box-shadow .15s; font-family: var(--font);
  }
  .search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .chip {
    border: 1px solid var(--line); background: var(--surface); color: var(--muted);
    padding: 6px 14px; border-radius: 999px; font-size: .85rem; cursor: pointer;
    transition: all .15s;
  }
  .chip:hover { color: var(--text); border-color: var(--accent); }
  .chip.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .grid {
    display: grid; gap: 16px; margin-top: 22px;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
  .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 18px; box-shadow: var(--shadow); transition: transform .15s, border-color .15s;
    display: flex; flex-direction: column; gap: 8px;
  }
  .card:hover { transform: translateY(-3px); border-color: var(--accent); }
  .card-title { font-weight: 600; font-size: 1.05rem; color: var(--accent); word-break: break-word; }
  .card-desc { margin: 0; color: var(--muted); font-size: .9rem; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 6px; }
  .tag { font-size: .75rem; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 6px; }
  .cat { font-size: .72rem; color: var(--accent2); border: 1px solid var(--accent2); padding: 1px 8px; border-radius: 6px; }
  .empty { text-align: center; color: var(--muted); padding: 60px 0; display: none; }
  footer.site-footer { margin-top: 48px; color: var(--muted); font-size: .82rem; text-align: center; border-top: 1px solid var(--line); padding-top: 20px; }
  .count { color: var(--muted); font-size: .85rem; margin: 0 0 4px; }
  @media (max-width: 600px) {
    .site-header .brand { font-size: 22px; }
    .site-header { padding: 16px 14px 10px; }
    .wrap { padding: 20px 14px 48px; }
    .site-header .nav a { padding: 6px 9px; font-size: .82rem; }
  }
</style>
</head>
<body>
  <div class="site-header">
    <img src="${escapeHtml(avatar)}" class="avatar" alt="iBitBetter" />
    <span class="brand">iBitBetter</span>
    <nav class="nav">
      <a href="${escapeHtml(cfg.siteUrl || "/")}">首页</a>
      <a href="${escapeHtml((cfg.siteUrl || "").replace(/\/$/, ""))}/tag.html">标签</a>
      <a href="${escapeHtml((cfg.siteUrl || "").replace(/\/$/, ""))}/about.html">关于</a>
    </nav>
  </div>
  <div class="wrap">
    <header class="page-head">
      <h1>${safeTitle}</h1>
      <p class="sub">${safeSite} · 由 GitHub Issue 评论自动整理</p>
      <p class="intro">在这里统一收录我私藏的奇趣网站与效率工具。想添加新资源？在站点仓库的收藏家 Issue 下评论一条 <code>- [名称](链接) 一句话描述 | #标签</code> 即可，页面会自动更新。</p>
    </header>
    <div class="toolbar">
      <input id="search" class="search" type="search" placeholder="搜索网站、描述或标签…" autocomplete="off" />
      ${tagBar}
    </div>
    <p class="count">共 ${count} 个资源</p>
    <main class="grid" id="grid">
${cards}
    </main>
    <p class="empty" id="empty">没有匹配的资源 🤔</p>
    <footer class="site-footer">
      本页由 <a href="${safeIssue}" target="_blank" rel="noopener noreferrer">GitHub Issue #${cfg.issueNumber}</a> 的评论自动生成 · 更新于 ${safeTime}
    </footer>
  </div>
  <script>
    (function () {
      var grid = document.getElementById("grid");
      var empty = document.getElementById("empty");
      var search = document.getElementById("search");
      var chips = document.getElementById("chips");
      var activeTag = "";
      var cards = Array.prototype.slice.call(grid.querySelectorAll(".card"));

      function apply() {
        var q = (search.value || "").trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (c) {
          var tag = c.getAttribute("data-tags") || "";
          var title = c.getAttribute("data-title") || "";
          var desc = c.getAttribute("data-desc") || "";
          var okTag = !activeTag || (" " + tag + " ").indexOf(" " + activeTag + " ") > -1;
          var okText = !q || title.indexOf(q) > -1 || desc.indexOf(q) > -1 || tag.indexOf(q) > -1;
          var ok = okTag && okText;
          c.style.display = ok ? "" : "none";
          if (ok) shown++;
        });
        empty.style.display = shown === 0 ? "block" : "none";
      }

      search.addEventListener("input", apply);
      if (chips) {
        chips.addEventListener("click", function (e) {
          var btn = e.target.closest(".chip");
          if (!btn) return;
          activeTag = btn.getAttribute("data-tag") || "";
          chips.querySelectorAll(".chip").forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          apply();
        });
      }
      apply();
    })();
  </script>
</body>
</html>
`;
}

// ---------- 主流程 ----------
async function main() {
  const cfg = await loadConfig();

  if (LOCAL_FILE) {
    console.log(`[local] 用本地文件 ${LOCAL_FILE} 作为 Issue 正文生成预览…`);
    const body = await readFile(resolve(ROOT, LOCAL_FILE), "utf8");
    const items = dedupe(parseBlock(body, ""));
    const html = buildHtml(cfg, items, new Date().toISOString());
    const out = resolve(ROOT, cfg.outputPath);
    await writeFile(out, html, "utf8");
    console.log(`[local] 已生成预览：${out}（${items.length} 个资源）`);
    return;
  }

  if (DEMO) {
    console.log("[demo] 使用内置示例数据生成预览…");
    const items = dedupe([
      ...parseBlock(DEMO_BODY),
      ...parseBlock(DEMO_COMMENT_1),
      ...parseBlock(DEMO_COMMENT_2),
    ]);
    const html = buildHtml(cfg, items, new Date().toISOString());
    const out = resolve(ROOT, cfg.outputPath);
    await writeFile(out, html, "utf8");
    console.log(`[demo] 已生成预览：${out}（${items.length} 个资源）`);
    return;
  }

  if (!cfg.repository) {
    console.error("缺少仓库信息：请设置 GITHUB_REPOSITORY 环境变量或在 config.json 中配置 repository。");
    process.exit(1);
  }

  console.log(`读取 issue #${cfg.issueNumber} (${cfg.repository}) …`);
  const issue = await fetchIssue(cfg);
  const comments = await fetchComments(cfg);
  console.log(`issue 正文 + ${comments.length} 条评论`);

  const items = dedupe([
    ...parseBlock(issue.body, ""),
    ...comments.map((c) => parseBlock(c.body, "")).flat(),
  ]);

  const html = buildHtml(cfg, items, new Date().toISOString());
  const out = resolve(ROOT, cfg.outputPath);
  await writeFile(out, html, "utf8");
  console.log(`已生成 ${out}（${items.length} 个资源）`);
}

// 示例数据（--demo）
const DEMO_BODY = `我平时收藏的好东西都会丢在这里，欢迎自取。

- [Excalidraw](https://excalidraw.com/) 手绘风在线白板，画架构图神器 | #绘图 #免费
- [Remove.bg](https://www.remove.bg/) 一键去除图片背景 | #图片 #AI`;

const DEMO_COMMENT_1 = `<!-- category: 效率工具 -->
- [TinyPNG](https://tinypng.com/) 智能压缩 PNG/JPG，体积砍半画质不变 | #图片 #压缩
- [Cron](https://cron.com/) 极简时间管理，和 Google Calendar 同步 | #时间管理 #日历`;

const DEMO_COMMENT_2 = `- [Photopea](https://www.photopea.com/) 浏览器里的 Photoshop 平替 | #图片 #编辑 #免费
- [tldraw](https://www.tldraw.com/) 无限画布协作白板 | #绘图 #协作`;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
