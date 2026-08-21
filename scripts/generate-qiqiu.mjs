#!/usr/bin/env node
// 奇趣网站收藏家 —— 资源页生成器
// 读取 GitHub Issue 正文与评论 → 提取「奇趣网站 / 软件资源」→ 生成独立静态页 curious-websites.html
// 风格与 iBitBetter (ibitbetter.space) 站点一致：极简阅读风（白底 + 蓝链，类 greyli.com / Twenty Twelve），明暗主题自适应。
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
    ownerLogin: process.env.OWNER || process.env.OWNER_LOGIN || fileConfig.ownerLogin || "",
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

// ---------- Reactions（站长 ❤️ 判定） ----------
// 拉某条评论的 heart reactions（分页）
async function fetchHeartReactions(cfg, commentId) {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = `https://api.github.com/repos/${cfg.repository}/issues/comments/${commentId}/reactions?content=heart&per_page=${perPage}&page=${page}`;
    const res = await githubFetch(url, cfg.token);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

// reactions 里是否有指定登录用户的 ❤️
function hasOwnerHeart(reactions, ownerLogin) {
  return reactions.some(
    (r) => r.content === "heart" && r.user && r.user.login === ownerLogin
  );
}

// 限制并发：把数组按 worker 处理，结果按原顺序返回
async function mapWithLimit(items, limit, worker) {
  const result = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const cur = idx++;
      result[cur] = await worker(items[cur], cur);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return result;
}

// 收录规则（生成器内部判定）：
//   - 站长本人评论：直接收录
//   - 非站长评论：仅当站长点过 ❤️ 才收录
// issue 正文在 main() 里单独处理，这里只管 comments
async function collectAcceptedComments(comments, cfg) {
  const ownerLogin = cfg.ownerLogin;
  if (!ownerLogin) return comments; // 无法判定归属时全部收录（兜底）
  const mine = [];
  const others = [];
  for (const c of comments) {
    if (c.user && c.user.login === ownerLogin) mine.push(c);
    else others.push(c);
  }
  if (others.length === 0) return mine;
  const flags = await mapWithLimit(others, Math.min(6, others.length), async (c) => {
    try {
      const reactions = await fetchHeartReactions(cfg, c.id);
      return hasOwnerHeart(reactions, ownerLogin);
    } catch {
      return false;
    }
  });
  const liked = others.filter((_, i) => flags[i]);
  return [...mine, ...liked];
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

function faviconUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return `https://www.bing.com/favicon.ico?url=${u.hostname}`;
    }
  } catch {
    /* ignore */
  }
  return "";
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
  const normTags = normalizeTags(tags);
  const normCat = normalizeTags([category]);
  items.push({
    title: title.slice(0, 120),
    url: safe,
    desc: desc.slice(0, 300),
    tags: normTags,
    category: normCat[0] || "",
  });
}

// ---------- 标签归一化（精简标签体系） ----------
// 数据里会写很多细标签（如 #拼图 #图片 #效率），页面只展示顶层标签。
// 细标签 → 顶层标签 的映射；未列出的细标签若不在白名单则丢弃。
// 顶层白名单同时预留了「网盘」「软件」两类，供后期扩展资源类型。
const TAG_MAP = {
  // 效率：办公 / 文档 / 搜索 / 工具箱 / 番茄钟 / 开发 / 本地 / 比价 / 省钱 / 购物 / 工具
  效率: "效率", 办公: "效率", 文档: "效率", 搜索: "效率", 工具箱: "效率",
  番茄钟: "效率", 开发: "效率", 本地: "效率", 比价: "效率", 省钱: "效率",
  购物: "效率", 工具: "效率", 硬件: "效率", 测评: "效率",
  // 游戏（含 io 类）
  游戏: "游戏", io: "游戏",
  // 创意：灵感 / 艺术 / 怀旧 / 传统 / 表情
  创意: "创意", 灵感: "创意", 艺术: "创意", 怀旧: "创意", 传统: "创意", 表情: "创意",
  // 学习：古籍 / 汉字 / 教育 / 科普 / 背单词 / 检索
  学习: "学习", 古籍: "学习", 汉字: "学习", 教育: "学习", 科普: "学习",
  背单词: "学习", 检索: "学习",
  // 生活：健康 / 菜谱 / 天气 / 查询
  生活: "生活", 健康: "生活", 菜谱: "生活", 天气: "生活", 查询: "生活",
  // 影音：音乐 / 电台 / 摄影 / 航拍 / 白噪音 / 放松
  音乐: "影音", 电台: "影音", 摄影: "影音", 航拍: "影音", 白噪音: "影音", 放松: "影音",
  // 趣味：解压 / 专注 / 摸鱼 / 沙雕 / 心理
  趣味: "趣味", 解压: "趣味", 专注: "趣味", 摸鱼: "趣味", 沙雕: "趣味", 心理: "趣味",
  // AI（人工智能）
  人工智能: "AI", AI: "AI",
  // 资讯：新闻 / 核查 / 信息
  新闻: "资讯", 核查: "资讯", 信息: "资讯",
  // 设计：图片 / 素材 / 拼图
  设计: "设计", 图片: "设计", 素材: "设计", 拼图: "设计",
  // 探索：世界 / 历史（地理与国际视野）
  世界: "探索", 历史: "探索",
  // 预留扩展（后期资源类型）
  网盘: "网盘", 软件: "软件",
};
const TOP_TAGS = new Set([
  "效率", "游戏", "创意", "学习", "生活", "影音", "趣味",
  "AI", "资讯", "设计", "探索", "网盘", "软件",
]);
function normalizeTags(rawTags) {
  const out = [];
  const seen = new Set();
  for (const t of rawTags || []) {
    if (!t) continue;
    const mapped = TAG_MAP[t] || t;
    if (!TOP_TAGS.has(mapped)) continue; // 不在顶层白名单内的细标签丢弃
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
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

// 主页头部图标 SVG path（与 Gmeek 站点一致）。专题页是独立生成的静态页，
// 没有 Gmeek 运行时来填充图标，因此把路径硬编码进来，保证离线也能渲染同款图标。
// 顺序与主页可见图标一致：搜索 / now / 关于 / 奇趣网站收藏家 / RSS / 主题切换
// （privacy、terms 按站长要求隐藏，不在此列出）。
const ICONS = {
  home: "M6.906.664a1.749 1.749 0 0 1 2.187 0l5.25 4.2c.415.332.657.835.657 1.367v7.019A1.75 1.75 0 0 1 13.25 15h-3.5a.75.75 0 0 1-.75-.75V9H7v5.25a.75.75 0 0 1-.75.75h-3.5A1.75 1.75 0 0 1 1 13.25V6.23c0-.531.242-1.034.657-1.366l5.25-4.2Zm1.25 1.171a.25.25 0 0 0-.312 0l-5.25 4.2a.25.25 0 0 0-.094.196v7.019c0 .138.112.25.25.25H5.5V8.25a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v5.25h2.75a.25.25 0 0 0 .25-.25V6.23a.25.25 0 0 0-.094-.195Z",
  search: "M15.7 13.3l-3.81-3.83A5.93 5.93 0 0 0 13 6c0-3.31-2.69-6-6-6S1 2.69 1 6s2.69 6 6 6c1.3 0 2.48-.41 3.47-1.11l3.83 3.81c.19.2.45.3.7.3.25 0 .52-.09.7-.3a.996.996 0 0 0 0-1.41v.01zM7 10.7c-2.59 0-4.7-2.11-4.7-4.7 0-2.59 2.11-4.7 4.7-4.7 2.59 0 4.7 2.11 4.7 4.7 0 2.59-2.11 4.7-4.7 4.7z",
  rss: "M2.002 2.725a.75.75 0 0 1 .797-.699C8.79 2.42 13.58 7.21 13.974 13.201a.75.75 0 0 1-1.497.098 10.502 10.502 0 0 0-9.776-9.776.747.747 0 0 1-.7-.798ZM2.84 7.05h-.002a7.002 7.002 0 0 1 6.113 6.111.75.75 0 0 1-1.49.178 5.503 5.503 0 0 0-4.8-4.8.75.75 0 0 1 .179-1.489ZM2 13a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z",
  about: "M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.004 6.004 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z",
  now: "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm.252-12.932a.476.476 0 0 0-.682.195l-1.2 2.432-2.684.39a.477.477 0 0 0-.266.816l1.944 1.892-.46 2.674a.479.479 0 0 0 .694.504L8 10.709l2.4 1.261a.478.478 0 0 0 .694-.504l-.458-2.673L12.578 6.9a.479.479 0 0 0-.265-.815l-2.685-.39-1.2-2.432a.473.473 0 0 0-.176-.195Z",
  sun: "M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 12a4 4 0 100-8 4 4 0 000 8zM8 0a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0V.75A.75.75 0 018 0zm0 13a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 018 13zM2.343 2.343a.75.75 0 011.061 0l1.06 1.061a.75.75 0 01-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zm9.193 9.193a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.061zM16 8a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0116 8zM3 8a.75.75 0 01-.75.75H.75a.75.75 0 010-1.5h1.5A.75.75 0 013 8zm10.657-5.657a.75.75 0 010 1.061l-1.061 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zm-9.193 9.193a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.061-1.06l1.06-1.061a.75.75 0 011.061 0z",
  moon: "M9.598 1.591a.75.75 0 01.785-.175 7 7 0 11-8.967 8.967.75.75 0 01.961-.96 5.5 5.5 0 007.046-7.046.75.75 0 01.175-.786zm1.616 1.945a7 7 0 01-7.678 7.678 5.5 5.5 0 107.678-7.678z",
  curious: "M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25ZM14.5 6h-13v7.25c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25Zm-6-3.5v2h6V2.75a.25.25 0 0 0-.25-.25ZM5 2.5v2h2v-2Zm-3.25 0a.25.25 0 0 0-.25.25V4.5h2v-2Z",
};

// ---------- 渲染（iBitBetter 暖色编辑风） ----------
function renderCards(items) {
  return items
    .map((it) => {
      const tagsHtml = it.tags
        .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
        .join("");
      const showCat = it.category && !it.tags.includes(it.category);
      const catHtml = showCat
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
  // canonical 使用「线上访问路径」(取 outputPath 的文件名)，与仓库内输出目录无关
  const slug = (cfg.outputPath || "curious-websites.html").split("/").pop() || "curious-websites.html";
  const canonical = cfg.siteUrl
    ? `${cfg.siteUrl.replace(/\/$/, "")}/${slug}`
    : "";
  const canonicalTag = canonical
    ? `<link rel="canonical" href="${escapeHtml(canonical)}" />`
    : "";
  const avatar = cfg.siteUrl
    ? `${cfg.siteUrl.replace(/\/$/, "")}/assets/curious.svg`
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
    --bg: #ffffff;
    --surface: #ffffff;
    --text: #444444;
    --muted: #757575;
    --accent: #3475e4;
    --accent-hover: #21759b;
    --accent-soft: #eef4fc;
    --accent2: #2f6fb0;
    --line: #e6e6e6;
    --radius: 6px;
    --shadow: none;
    --font: "Helvetica Neue", Helvetica, Arial, "PingFang SC",
      "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
  }
  [data-color-mode="dark"] {
    --bg: #181818;
    --surface: #1f1f1f;
    --text: #dcdcdc;
    --muted: #9a9a9a;
    --accent: #6ea8fe;
    --accent-hover: #9ec5ff;
    --accent-soft: #1c2733;
    --accent2: #7fb0e0;
    --line: #333333;
    --shadow: none;
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
    max-width: 900px; margin: 0 auto; padding: 22px 45px 14px;
    border-bottom: 1px solid var(--line);
  }
  .site-header .avatar {
    width: 44px; height: 44px; border-radius: 0; object-fit: cover;
    flex: none;
  }
  .site-header .brand {
    font-family: Monaco, "PingFang SC", monospace; font-size: 24px; font-weight: 700;
    color: var(--text); letter-spacing: -.02em;
  }
  .site-header .brand-wrap { display: flex; align-items: center; gap: 12px; text-decoration: none; }
  /* —— 顶部右侧图标栏（与站点 now/about 页一致） —— */
  .site-header .title-right { margin-left: auto; display: flex; align-items: center; gap: 2px; }
  .site-header .title-right .btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; padding: 0; margin: 0;
    border: none; background: transparent; border-radius: 50%;
    color: var(--muted); cursor: pointer; text-decoration: none;
    transition: color .15s, background .15s;
  }
  .site-header .title-right .btn:hover { color: var(--accent); background: var(--accent-soft); }
  .site-header .title-right .btn.active-cur { color: var(--accent); }
  .site-header .title-right .octicon { fill: currentColor; }
  /* 屏幕阅读器专用（保留 h1 供 SEO，但不显示） */
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  .wrap { max-width: 900px; margin: 0 auto; padding: 28px 45px 64px; }
  header.page-head h1 {
    font-size: clamp(1.8rem, 4.5vw, 2.6rem); margin: 0 0 6px; letter-spacing: -.02em;
  }
  header.page-head .sub { color: var(--muted); margin: 0; font-size: .98rem; }
  header.page-head .intro {
    color: var(--text); opacity: .85; margin: 14px 0 0; font-size: .95rem;
    background: var(--accent-soft); border-left: 3px solid var(--accent);
    padding: 16px 18px; border-radius: 10px; line-height: 1.75;
  }
  header.page-head .intro p { margin: 0 0 12px; }
  header.page-head .intro p:last-child { margin-bottom: 0; }
  header.page-head .intro strong { color: var(--accent); font-weight: 600; }
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
    position: relative;
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 18px; box-shadow: var(--shadow); transition: transform .15s, border-color .15s;
    display: flex; flex-direction: column; gap: 8px;
  }
  .card:hover { border-color: var(--accent); }
  .card-favicon {
    position: absolute; top: 12px; right: 12px;
    width: 22px; height: 22px; object-fit: contain;
    background: var(--surface); border: 1px solid var(--line); border-radius: 4px;
    padding: 2px; pointer-events: none;
  }
  .card-title { font-weight: 600; font-size: 1.05rem; color: var(--text); word-break: break-word; }
  .card:hover .card-title { color: var(--accent); }
  .card-desc { margin: 0; color: var(--muted); font-size: .9rem; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 6px; }
  .tag { font-size: .75rem; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 6px; }
  .cat { font-size: .72rem; color: var(--accent2); border: 1px solid var(--accent2); padding: 1px 8px; border-radius: 6px; }
  .empty { text-align: center; color: var(--muted); padding: 60px 0; display: none; }
  footer.site-footer { margin-top: 48px; color: var(--muted); font-size: .82rem; text-align: center; border-top: 1px solid var(--line); padding-top: 20px; }
  .comments { margin-top: 36px; }
  .comments .utterances { max-width: 100%; }
  .count { color: var(--muted); font-size: .85rem; margin: 0 0 4px; }
  /* 移动端：标签条改为单行横向滚动，避免折行撑满整屏把卡片挤掉 */
  @media (max-width: 600px) {
    .site-header { padding: 12px 16px 8px; gap: 8px; flex-wrap: nowrap; }
    .site-header .avatar { width: 36px; height: 36px; }
    .site-header .brand { font-size: 20px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title-right { gap: 0; flex: none; }
    .title-right .btn { width: 32px; height: 32px; }
    .wrap { padding: 18px 16px 40px; }
    .toolbar { padding: 12px 0 8px; }
    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      margin-top: 10px;
      padding-bottom: 4px;
    }
    .chips::-webkit-scrollbar { display: none; }
    .chip { flex: 0 0 auto; white-space: nowrap; }
    .grid { grid-template-columns: 1fr; }
    .card { padding: 16px; }
    .card-favicon { top: 10px; right: 10px; width: 20px; height: 20px; }
    .card-title { font-size: 1.12rem; }
  }
</style>
</head>
<body>
  <div class="site-header">
    <a class="brand-wrap" href="${escapeHtml(cfg.siteUrl || "/")}">
      <img src="${escapeHtml(avatar)}" class="avatar" alt="奇趣网站收藏家" />
      <span class="brand">Curious</span>
    </a>
    <div class="title-right">
      <a href="${escapeHtml(cfg.siteUrl || "/")}" class="btn btn-invisible circle" title="首页" aria-label="首页">
        <svg class="octicon" width="16" height="16"><path fill-rule="evenodd" d="${ICONS.home}"></path></svg>
      </a>
      <a href="${escapeHtml((cfg.siteUrl || "").replace(/\/$/, ""))}/curious-websites.html" class="btn btn-invisible circle active-cur" title="Curious" aria-label="Curious">
        <svg class="octicon" width="16" height="16"><path fill-rule="evenodd" d="${ICONS.curious}"></path></svg>
      </a>
      <button class="btn btn-invisible circle" type="button" onclick="qiqiuModeSwitch()" title="切换主题" aria-label="切换主题">
        <svg class="octicon" width="16" height="16"><path id="qiqiuThemeSwitch" fill-rule="evenodd"></path></svg>
      </button>
    </div>
  </div>
  <div class="wrap">
    <header class="page-head">
      <h1 class="sr-only">${safeTitle}</h1>
      <div class="intro">
        <p>「奇趣网站收藏家」互联网上精彩内容浩如烟海，收集有意思的网站，体验别样的风景。</p>
      </div>
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
    <section class="comments" aria-label="评论区">
      <script src="https://utteranc.es/client.js"
              repo="${escapeHtml(cfg.repository)}"
              issue-term="pathname"
              theme="github-light"
              crossorigin="anonymous"
              async>
      </script>
    </section>
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
  <script>
    var QIQIU_ICONS = { sun: "${ICONS.sun}", moon: "${ICONS.moon}" };
    // 评论区（Utterances）主题同步：dark → dark-blue，light → github-light
    function qiqiuUtterancesTheme(mode) {
      var utheme = mode === "dark" ? "dark-blue" : "github-light";
      var iframe = document.querySelector(".utterances-frame");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: "set-theme", theme: utheme }, "https://utteranc.es");
      }
    }
    function qiqiuModeSwitch() {
      var cur = document.documentElement.getAttribute("data-color-mode") || "light";
      var next = cur === "light" ? "dark" : "light";
      localStorage.setItem("meek_theme", next);
      document.documentElement.setAttribute("data-color-mode", next);
      var sw = document.getElementById("qiqiuThemeSwitch");
      if (sw) sw.setAttribute("d", next === "light" ? QIQIU_ICONS.sun : QIQIU_ICONS.moon);
      qiqiuUtterancesTheme(next);
    }
    (function () {
      var cur = document.documentElement.getAttribute("data-color-mode") || "light";
      var sw = document.getElementById("qiqiuThemeSwitch");
      if (sw) sw.setAttribute("d", cur === "light" ? QIQIU_ICONS.sun : QIQIU_ICONS.moon);
      // 等 Utterances iframe 挂载后同步一次主题（避免初始闪烁）
      (function syncOnce() {
        var iframe = document.querySelector(".utterances-frame");
        if (iframe) { qiqiuUtterancesTheme(cur); return; }
        setTimeout(syncOnce, 400);
      })();
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

  // 收录规则（生成器内部判定）：
  //   - issue 正文：始终收录
  //   - 评论：站长本人评论 或 站长点过 ❤️ 的评论
  const ownerLogin = cfg.ownerLogin || (issue.user && issue.user.login) || "";
  const accepted = await collectAcceptedComments(comments, cfg);
  console.log(
    `issue 正文 + ${comments.length} 条评论 → 收录 ${accepted.length} 条（站长本人 + 站长 ❤️）`
  );

  const items = dedupe([
    ...parseBlock(issue.body, ""),
    ...accepted.map((c) => parseBlock(c.body, "")).flat(),
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
