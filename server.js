const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = __dirname;
const GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss";
const TREND_LIMIT = Number(process.env.TREND_LIMIT || 12);
const TREND_GEO = process.env.TREND_GEO || "US";
const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

const productCategories = [
  {
    category: "T-shirts",
    products: ["graphic tee", "comfort tee", "oversized shirt", "print-on-demand shirt"],
  },
  {
    category: "Cups",
    products: ["ceramic mug", "travel tumbler", "camp cup", "water bottle"],
  },
  {
    category: "Merch",
    products: ["sticker pack", "tote bag", "phone case", "poster", "desk accessory"],
  },
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

let articleCache = [];
let cacheFetchedAt = 0;
let cursor = 0;
let categoryCursor = 0;

function sourceCatalog() {
  return [
    {
      id: "google-trends",
      name: "Google Trends RSS",
      status: "active",
      statusLabel: "Live now",
      signal: "Realtime search demand by country",
      setup: "No key required; currently using geo=US.",
      where: TREND_GEO,
    },
    {
      id: "ebay",
      name: "eBay Browse API",
      status: process.env.EBAY_ACCESS_TOKEN ? "active" : "optional",
      statusLabel: process.env.EBAY_ACCESS_TOKEN ? "Token found" : "Optional key",
      signal: "Marketplace listings, prices, seller locations, and demand proxies",
      setup: "Free developer account, OAuth token, set EBAY_ACCESS_TOKEN and EBAY_MARKETPLACE_ID.",
      where: EBAY_MARKETPLACE_ID,
    },
    {
      id: "etsy",
      name: "Etsy Open API",
      status: process.env.ETSY_API_KEY ? "active" : "optional",
      statusLabel: process.env.ETSY_API_KEY ? "Key found" : "Optional key",
      signal: "Active listings, tags, shops, listing images, and keyword competition",
      setup: "Free Etsy developer app, set ETSY_API_KEY. Broad sold-count data is limited.",
      where: "Marketplace",
    },
    {
      id: "youtube",
      name: "YouTube Data API",
      status: process.env.YOUTUBE_API_KEY ? "active" : "optional",
      statusLabel: process.env.YOUTUBE_API_KEY ? "Key found" : "Optional key",
      signal: "Creator/video velocity for design niches and product ideas",
      setup: "Free Google Cloud API key with quota, set YOUTUBE_API_KEY.",
      where: "Global or regional search",
    },
    {
      id: "gdelt",
      name: "GDELT Doc API",
      status: "optional",
      statusLabel: "No key, throttle",
      signal: "News/media trend coverage and geography hints",
      setup: "No key required, but throttle requests to avoid 429 responses.",
      where: "Global media",
    },
  ];
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function safePath(urlPath) {
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return filePath;
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const filePath = safePath(decodeURIComponent(url.pathname));

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    const shouldCache = ![".html", ".css", ".js"].includes(extension);

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": shouldCache ? "public, max-age=3600" : "no-store",
    });
    response.end(content);
  });
}

async function trendsRequest() {
  const url = new URL(GOOGLE_TRENDS_RSS_URL);
  url.searchParams.set("geo", TREND_GEO);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "MerchTrendReviewAgent/1.0",
      },
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error.cause?.message || error.message;
    throw new Error(`Unable to reach the free trend API: ${detail}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Trend RSS returned HTTP ${response.status}`);
  }

  return parseTrendRss(text);
}

async function loadTrendArticles(force = false) {
  const cacheAge = Date.now() - cacheFetchedAt;

  if (!force && articleCache.length && cacheAge < 9 * 60 * 1000) {
    return articleCache;
  }

  const articles = await trendsRequest();
  articleCache = articles.length ? articles.slice(0, Math.max(TREND_LIMIT, 3)) : fallbackArticles();
  cacheFetchedAt = Date.now();
  cursor = 0;
  return articleCache;
}

function parseTrendRss(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  return items.map((item) => {
    const newsTitle = extractTag(item, "ht:news_item_title");
    const newsUrl = extractTag(item, "ht:news_item_url");
    const newsPicture = extractTag(item, "ht:news_item_picture");

    return {
      title: extractTag(item, "title"),
      url: newsUrl || extractTag(item, "link"),
      source: extractTag(item, "ht:picture_source") || "Google Trends",
      image: newsPicture || extractTag(item, "ht:picture"),
      traffic: extractTag(item, "ht:approx_traffic"),
      publishedAt: extractTag(item, "pubDate"),
      relatedHeadline: newsTitle,
    };
  });
}

function extractTag(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function reviewTrend(article) {
  const category = productCategories[categoryCursor % productCategories.length];
  categoryCursor += 1;

  const title = article.title || "Untitled trend signal";
  const text = `${title} ${article.relatedHeadline || ""} ${article.source || ""}`.toLowerCase();
  const product = pickProduct(category.products || [], text);
  const productContext = `${category.category} / ${product}`;
  const popularityReasons = inferPopularityReasons(article, text, productContext);
  const graphicElements = inferGraphicElements(title, text, product);
  const signals = [];
  const watchouts = [];
  let score = 58;

  if (article.traffic) {
    score += 12;
    signals.push(`Current search interest is elevated at roughly ${article.traffic} searches.`);
  } else {
    signals.push("This surfaced in current search trends and may be useful for timely inspiration.");
  }

  if (/\b(cup|world cup|team|game|movie|album|tour|celebrity|holiday|festival|season|finals)\b/.test(text)) {
    score += 10;
    signals.push("The topic maps to an event, fandom, or seasonal buying moment.");
  }

  if (/\b(style|fashion|shirt|outfit|look|color|design|aesthetic)\b/.test(text)) {
    score += 8;
    signals.push("The trend includes a visual cue that can guide product design direction.");
  }

  if (article.image) {
    score += 5;
    signals.push("A source image is available for color, mood, and composition research.");
  } else {
    watchouts.push("No source image was available; validate the visual direction manually.");
  }

  if (/\b(licensed|trademark|copyright|official|brand)\b/.test(text)) {
    score -= 12;
    watchouts.push("Potential IP risk: avoid names, logos, lyrics, characters, and brand marks.");
  }

  if (/\b(shirt|tee|mug|tumbler|sticker|poster|tote|case|merch|gift)\b/.test(text)) {
    score += 7;
    signals.push("The article already has a merch-adjacent product signal.");
  }

  signals.push(`Where: Google Trends is reporting this in ${TREND_GEO}.`);

  if (!signals.length) {
    signals.push("This surfaced through a current trend query and may be useful for broader inspiration.");
  }

  if (!watchouts.length) {
    watchouts.push("Check marketplace saturation before producing variations.");
  }

  score = Math.max(1, Math.min(100, score));

  return {
    id: article.url || title,
    category: category.category,
    product,
    title,
    url: article.url || "#",
    image: article.image || "",
    imageResults: buildImageResults(article),
    sourceLinks: buildSourceLinks(title, article),
    source: article.source || "Google Trends",
    market: TREND_GEO,
    evidence: article.traffic ? `Google Trends traffic: ${article.traffic}` : "Google Trends RSS placement",
    score,
    popularityReasons,
    graphicElements,
    designerBrief: buildDesignerBrief(title, product, popularityReasons, graphicElements),
    signals,
    watchouts,
    summary: `Demand signal: this topic is moving in ${TREND_GEO} search trends. Use it as inspiration for a ${product}, then validate marketplace saturation before producing. Keep the design original, avoid protected marks, and translate the theme into colors, typography, phrases, or motifs rather than copying source artwork.`,
  };
}

function buildImageResults(article) {
  if (!article.image) {
    return [];
  }

  return [
    {
      title: article.relatedHeadline || article.title || "Trend source image",
      url: article.image,
      source: article.source || "Google Trends",
      link: article.url || "#",
    },
  ];
}

function buildSourceLinks(title, article) {
  const encoded = encodeURIComponent(title);
  const links = [];

  if (article.url && article.url !== "#") {
    links.push({
      label: article.source ? `${article.source} article` : "Source article",
      url: article.url,
      type: "source",
    });
  }

  links.push(
    {
      label: "Google Trends keyword check",
      url: `https://trends.google.com/trends/explore?geo=${encodeURIComponent(TREND_GEO)}&q=${encoded}`,
      type: "demand",
    },
    {
      label: "Etsy listing search",
      url: `https://www.etsy.com/search?q=${encoded}`,
      type: "marketplace",
    },
    {
      label: "eBay sold/listing search",
      url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
      type: "marketplace",
    },
  );

  return links;
}

function inferPopularityReasons(article, text, productContext) {
  const reasons = [];

  if (article.traffic) {
    reasons.push(`Search volume is rising now (${article.traffic} in Google Trends), so buyers may recognize the theme quickly.`);
  } else {
    reasons.push("The topic is appearing in current search trends, which makes it useful for timely product ideation.");
  }

  if (/\b(world cup|finals|game|match|team|season|holiday|festival|tour|album|movie)\b/.test(text)) {
    reasons.push("It connects to an event or fandom moment, which tends to drive short-window impulse buying.");
  }

  if (/\b(celebrity|player|singer|actor|influencer)\b/.test(text)) {
    reasons.push("The topic has personality-driven attention; use the mood or archetype, not protected names or likenesses.");
  }

  if (/\b(style|fashion|outfit|color|aesthetic|design)\b/.test(text)) {
    reasons.push("The trend contains visual language a designer can translate directly into color, type, and composition.");
  }

  reasons.push(`It is being reviewed against ${productContext}, so the idea can be converted into a concrete merch format instead of remaining a generic news topic.`);

  return reasons;
}

function inferGraphicElements(title, text, product) {
  const elements = [];
  const cleanTitle = title.replace(/\s+/g, " ").trim();

  elements.push(`Primary motif: an original symbol or illustration inspired by "${cleanTitle}", not copied source artwork.`);

  if (/\b(team|game|finals|cup|goalkeeper|baseball|basketball|soccer|football|hockey|racing)\b/.test(text)) {
    elements.push("Sport direction: bold varsity typography, badge shapes, pennants, motion lines, jersey-number layouts, and high-contrast team-adjacent colors without official logos.");
  }

  if (/\b(movie|album|tour|festival|concert|celebrity|singer|actor)\b/.test(text)) {
    elements.push("Pop-culture direction: poster-style framing, spotlight shapes, expressive lettering, halftone texture, and dramatic contrast.");
  }

  if (/\b(holiday|season|summer|winter|fall|spring|halloween|christmas)\b/.test(text)) {
    elements.push("Seasonal direction: simple icons, limited palette, decorative borders, and giftable phrasing that can work across apparel and drinkware.");
  }

  if (/\b(style|fashion|aesthetic|color|outfit)\b/.test(text)) {
    elements.push("Aesthetic direction: palette-first treatment, clean silhouette, pattern swatches, and typography that matches the mood of the trend.");
  }

  if (product.includes("drinkware")) {
    elements.push("Drinkware fit: use a vertical badge or wraparound repeat that stays readable on curved surfaces.");
  } else if (product.includes("sticker")) {
    elements.push("Sticker fit: use a strong silhouette, thick outline, and minimal small text so the design works at small sizes.");
  } else if (product.includes("poster")) {
    elements.push("Poster fit: use a larger focal image, hierarchy-driven type, and room for supporting detail.");
  } else {
    elements.push("Apparel fit: center-chest composition, two-to-four color screen-print palette, and readable lettering from a distance.");
  }

  return elements;
}

function buildDesignerBrief(title, product, popularityReasons, graphicElements) {
  return `Design brief for ${product}: create an original merch concept around "${title}". The reason to test it is ${popularityReasons[0].toLowerCase()} Start with ${graphicElements[0].replace("Primary motif: ", "").toLowerCase()} Keep the design ownable, simple enough for print, and clear without relying on protected marks.`;
}

function pickProduct(products, text) {
  if (text.includes("mug") || text.includes("tumbler") || text.includes("drinkware")) {
    return "drinkware design";
  }

  if (text.includes("sticker")) {
    return "sticker pack";
  }

  if (text.includes("poster")) {
    return "poster design";
  }

  if (text.includes("tote")) {
    return "tote bag";
  }

  if (text.includes("shirt") || text.includes("tee")) {
    return "graphic tee";
  }

  return products[0] || "merch design";
}

function fallbackArticles() {
  return [
    {
      category: "T-shirts",
      products: ["graphic tee"],
      title: "Retro sports graphics continue trending across casual fashion",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
    },
    {
      title: "Personalized drinkware remains a strong gifting category",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
    },
    {
      title: "Sticker and tote designs follow fandom and aesthetic microtrends",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
    },
  ];
}

async function handleReview(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const force = url.searchParams.get("trigger") === "manual";
    const articles = await loadTrendArticles(force);
    const article = articles[cursor % articles.length];
    cursor += 1;

    const review = reviewTrend(article);

    sendJson(response, 200, {
      source: article.source === "fallback.local" ? "fallback" : "google-trends",
      query: review.category,
      market: review.market,
      review,
      fetchedAt: new Date(cacheFetchedAt).toISOString(),
    });
  } catch (error) {
    console.error(`[api/review] ${error.message}`);
    sendJson(response, 502, {
      error: error.message,
      source: "google-trends",
    });
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      api: "Google Trends RSS",
      apiKeyRequired: false,
      categories: productCategories.map((trend) => trend.category),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sources") {
    sendJson(response, 200, {
      ok: true,
      sources: sourceCatalog(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/review") {
    handleReview(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405, { Allow: "GET" });
  response.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Merch Trend Review Agent running at http://127.0.0.1:${PORT}`);
});
