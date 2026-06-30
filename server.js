const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = __dirname;
const GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss";
const TREND_LIMIT = Number(process.env.TREND_LIMIT || 12);
const TREND_GEO = process.env.TREND_GEO || "US";
const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
const PUBLIC_SITE_URL =
  process.env.APP_PUBLIC_URL ||
  process.env.PUBLIC_SITE_URL ||
  "https://merch-trend-garden-agent-production.up.railway.app";
const ETSY_ACTIVE_LISTINGS_URL = "https://openapi.etsy.com/v3/application/listings/active";
const ETSY_API_KEY =
  process.env.ETSY_API_KEY ||
  (process.env.ETSY_KEYSTRING && process.env.ETSY_SHARED_SECRET
    ? `${process.env.ETSY_KEYSTRING}:${process.env.ETSY_SHARED_SECRET}`
    : "");
const PRINTIFY_API_TOKEN = process.env.PRINTIFY_API_TOKEN || "";
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY || "";
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || "";
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";
const GELATO_API_KEY = process.env.GELATO_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_AGENT_MODE = process.env.OPENAI_AGENT_MODE || "manual";
const OPENAI_AGENT_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_AGENT_MAX_OUTPUT_TOKENS || 700);

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
let latestDesignBrief = null;
let recentTrendIds = [];

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
      status: ETSY_API_KEY ? "active" : "optional",
      statusLabel: ETSY_API_KEY ? "Key found" : "Optional key",
      signal: "Sales proxy: active listings, tags, images, prices, and favorite-count signals",
      setup: "Set ETSY_API_KEY. Public endpoints do not expose broad verified sold counts; shop receipts require OAuth.",
      where: "Marketplace",
    },
    {
      id: "design-direction",
      name: "Design direction agent",
      status: "active",
      statusLabel: "Art direction",
      signal: "Evaluates design appeal, product fit, visual language, and commercial creative direction",
      setup: "No image generation. The designer agent gives direction for human or downstream production work.",
      where: "Design workflow",
    },
    {
      id: "openai-agents",
      name: "OpenAI agent runtime",
      status: OPENAI_API_KEY ? "active" : "optional",
      statusLabel: OPENAI_API_KEY ? `Key found, mode=${OPENAI_AGENT_MODE}` : "Optional key",
      signal: "AI-authored Demand, Sales, Design, Marketing, Risk, and Manager reports",
      setup: `Set OPENAI_API_KEY in Railway. Current defaults protect usage: mode=${OPENAI_AGENT_MODE}, model=${OPENAI_MODEL}, max_output_tokens=${OPENAI_AGENT_MAX_OUTPUT_TOKENS}.`,
      where: "Agent brain",
    },
    {
      id: "printify",
      name: "Printify API",
      status: PRINTIFY_API_TOKEN ? "active" : "optional",
      statusLabel: PRINTIFY_API_TOKEN ? "Token found" : "Optional token",
      signal: "Print-on-demand product publishing, mockups, variants, and shop workflow",
      setup: "Set PRINTIFY_API_TOKEN when ready to publish product drafts through Printify.",
      where: "Print-on-demand",
    },
    {
      id: "printful",
      name: "Printful API",
      status: PRINTFUL_API_KEY ? "active" : "optional",
      statusLabel: PRINTFUL_API_KEY ? "Token found" : "Optional token",
      signal: "Print-on-demand catalog, product templates, mockups, fulfillment, and orders",
      setup: "Set PRINTFUL_API_KEY when ready to create product templates or fulfillment flows.",
      where: "Print-on-demand",
    },
    {
      id: "shopify",
      name: "Shopify Admin API",
      status: SHOPIFY_STORE_URL && SHOPIFY_ADMIN_TOKEN ? "active" : "optional",
      statusLabel: SHOPIFY_STORE_URL && SHOPIFY_ADMIN_TOKEN ? "Store connected" : "Optional store",
      signal: "Owned storefront, product pages, pricing, inventory, campaign landing pages, and checkout",
      setup: "Set SHOPIFY_STORE_URL and SHOPIFY_ADMIN_TOKEN after creating a Shopify custom app.",
      where: "Owned storefront",
    },
    {
      id: "gelato",
      name: "Gelato API",
      status: GELATO_API_KEY ? "active" : "optional",
      statusLabel: GELATO_API_KEY ? "Key found" : "Optional key",
      signal: "Global print-on-demand production and fulfillment outlet",
      setup: "Set GELATO_API_KEY when ready to automate Gelato product/fulfillment workflows.",
      where: "Print-on-demand",
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
  articleCache = rankedCommercialDesignArticles(articles);
  cacheFetchedAt = Date.now();
  return articleCache;
}

function trendArticleText(article) {
  return `${article.title || ""} ${article.relatedHeadline || ""} ${article.source || ""}`.toLowerCase();
}

function trendId(article) {
  return article.url && article.url !== "#"
    ? article.url
    : article.title || JSON.stringify(article).slice(0, 80);
}

function isUnsuitableTrend(article) {
  const text = trendArticleText(article);
  const titleWords = String(article.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const titleHasCommercialContext = /\b(style|fashion|outfit|aesthetic|shirt|tee|mug|cup|sticker|poster|tote|gift|decor|recipe|garden|holiday|festival|sports|game|finals|season|book|reading|market|coffee|pet|fitness|travel)\b/.test(titleWords.join(" "));
  const possiblePersonOnlyTrend = titleWords.length >= 2 && titleWords.length <= 3 && titleWords.every((word) => /^[a-z]+$/.test(word)) && !titleHasCommercialContext;

  return possiblePersonOnlyTrend || /\b(death|dead|dies|died|killed|killing|murder|shooting|massacre|war|bomb|attack|terror|hostage|funeral|obituary|crash|accident|disaster|tragedy|tragic|earthquake|flood|wildfire|fire|hurricane|tornado|disease|outbreak|pandemic|abuse|assault|rape|missing|kidnapped|lawsuit|trial|sentenced|arrested|scotus|supreme court|court|judge|ruling|verdict|law|legal|congress|senate|president|election|politics|tariff|sony|playstation|nintendo|disney|marvel|star wars|pokemon|nike|adidas|apple|netflix)\b/.test(text);
}

function commercialDesignScore(article) {
  const text = trendArticleText(article);
  let score = 0;

  if (article.traffic) {
    score += 2;
  }

  if (article.image) {
    score += 2;
  }

  if (/\b(style|fashion|outfit|aesthetic|color|design|interior|decor|beauty|makeup|hair|nails)\b/.test(text)) {
    score += 5;
  }

  if (/\b(game|team|sports|finals|cup|tournament|race|stadium|season|holiday|festival|concert|tour|movie|album|show|celebrity)\b/.test(text)) {
    score += 3;
  }

  if (/\b(shirt|tee|mug|tumbler|sticker|poster|tote|phone case|merch|gift|collectible|print|wall art)\b/.test(text)) {
    score += 4;
  }

  if (/\b(recipe|food|drink|coffee|garden|travel|pet|fitness|wellness|home|school|graduation)\b/.test(text)) {
    score += 2;
  }

  if (/\b(stock|politics|election|court|crime|weather|forecast)\b/.test(text)) {
    score -= 3;
  }

  return score;
}

function rankedCommercialDesignArticles(articles) {
  const ranked = (articles || [])
    .filter((article) => !isUnsuitableTrend(article))
    .map((article) => ({
      article,
      score: commercialDesignScore(article),
    }))
    .filter((entry) => entry.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(TREND_LIMIT, 3))
    .map((entry) => ({
      ...entry.article,
      commercialDesignScore: entry.score,
    }));

  if (ranked.length >= Math.min(TREND_LIMIT, 6)) {
    return ranked;
  }

  const seen = new Set(ranked.map((article) => trendId(article)));
  const fallbacks = fallbackArticles()
    .filter((article) => !seen.has(trendId(article)))
    .map((article) => ({
      ...article,
      commercialDesignScore: article.commercialDesignScore || commercialDesignScore(article),
    }));

  return [...ranked, ...fallbacks].slice(0, Math.max(TREND_LIMIT, 6));
}

function selectNextTrendArticle(articles) {
  const usable = articles.length ? articles : fallbackArticles();

  for (let attempt = 0; attempt < usable.length; attempt += 1) {
    const article = usable[cursor % usable.length];
    cursor += 1;
    const id = trendId(article);

    if (!recentTrendIds.includes(id)) {
      recentTrendIds.unshift(id);
      recentTrendIds = recentTrendIds.slice(0, Math.min(20, usable.length));
      return article;
    }
  }

  recentTrendIds = [];
  const article = usable[cursor % usable.length];
  cursor += 1;
  recentTrendIds.unshift(trendId(article));
  return article;
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

async function fetchWithTimeout(url, options = {}, label = "request") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } catch (error) {
    const detail = error.cause?.message || error.message;
    throw new Error(`${label} failed: ${detail}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function compactText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function toSearchTerm(...parts) {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function listingPrice(listing) {
  const price = listing.price;

  if (!price) {
    return "";
  }

  if (typeof price === "string") {
    return price;
  }

  const amount = Number(price.amount);
  const divisor = Number(price.divisor || 100);
  const currency = price.currency_code || price.currency || "USD";

  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor === 0) {
    return "";
  }

  return `${currency} ${(amount / divisor).toFixed(2)}`;
}

function firstListingImage(listing) {
  const image = listing.images?.[0] || listing.Images?.[0];

  return image?.url_570xN || image?.url_fullxfull || image?.url_75x75 || "";
}

function topTermsFromListings(listings) {
  const counts = new Map();

  listings.forEach((listing) => {
    (listing.tags || []).forEach((tag) => {
      const normalized = String(tag || "").toLowerCase().trim();

      if (normalized.length > 2) {
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
    });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term);
}

function publicSalesFallback(query, product) {
  const keyword = toSearchTerm(query, product);

  return {
    provider: "etsy",
    status: ETSY_API_KEY ? "error" : "missing-key",
    query: keyword,
    summary: ETSY_API_KEY
      ? "Etsy sales proxy could not be loaded for this review."
      : "Set ETSY_API_KEY to let the Sales worker pull Etsy active-listing evidence. Public Etsy data is a market proxy, not verified sold-order volume.",
    listingCount: 0,
    averagePrice: "",
    topTags: [],
    topListings: [],
    scoreBoost: 0,
    sourceLinks: [
      {
        label: "Etsy live marketplace search",
        url: `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`,
        type: "sales",
      },
      {
        label: "eBay sold/listing search",
        url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}`,
        type: "sales",
      },
    ],
  };
}

function outletCatalog(query, product) {
  const keyword = toSearchTerm(query, product);
  const encoded = encodeURIComponent(keyword);

  return [
    {
      id: "shopify",
      name: "Shopify owned store",
      status: SHOPIFY_STORE_URL && SHOPIFY_ADMIN_TOKEN ? "connected" : "setup-needed",
      role: "Best long-term outlet because you own the storefront, customer list, pixel, bundles, and pricing.",
      nextStep: SHOPIFY_STORE_URL && SHOPIFY_ADMIN_TOKEN
        ? "Create a draft product page once the manager approves the design."
        : "Create a Shopify custom app and add SHOPIFY_STORE_URL plus SHOPIFY_ADMIN_TOKEN.",
      link: SHOPIFY_STORE_URL || "https://www.shopify.com/",
    },
    {
      id: "printify",
      name: "Printify POD",
      status: PRINTIFY_API_TOKEN ? "connected" : "setup-needed",
      role: "Fastest print-on-demand route for tees, mugs, stickers, totes, and variants.",
      nextStep: PRINTIFY_API_TOKEN
        ? "Use the approved design direction to prepare POD product drafts."
        : "Create a Printify API token and add PRINTIFY_API_TOKEN.",
      link: "https://printify.com/app/account/api",
    },
    {
      id: "printful",
      name: "Printful POD",
      status: PRINTFUL_API_KEY ? "connected" : "setup-needed",
      role: "Useful for catalog validation, mockups, fulfillment, and backup POD production.",
      nextStep: PRINTFUL_API_KEY
        ? "Create template products and compare margins against Printify."
        : "Create a Printful API token and add PRINTFUL_API_KEY.",
      link: "https://developers.printful.com/",
    },
    {
      id: "gelato",
      name: "Gelato global POD",
      status: GELATO_API_KEY ? "connected" : "setup-needed",
      role: "Good global production outlet when shipping location and international fulfillment matter.",
      nextStep: GELATO_API_KEY
        ? "Use Gelato for global fulfillment comparison."
        : "Create a Gelato API key and add GELATO_API_KEY.",
      link: "https://dashboard.gelato.com/",
    },
    {
      id: "ebay",
      name: "eBay demand/sales research",
      status: "research-ready",
      role: "No-key fallback for checking listing language, price bands, and sold/listing competition.",
      nextStep: "Use this immediately while Etsy approval is pending.",
      link: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
    },
    {
      id: "etsy",
      name: "Etsy marketplace proxy",
      status: ETSY_API_KEY ? "connected" : "approval-pending",
      role: "Best handmade/gift marketplace signal after Etsy app approval.",
      nextStep: ETSY_API_KEY
        ? "Pull active listings, tags, images, and price proxy data."
        : "Keep Etsy as research-only until the key is approved.",
      link: `https://www.etsy.com/search?q=${encoded}`,
    },
    {
      id: "amazon-merch",
      name: "Amazon Merch on Demand",
      status: "manual-setup",
      role: "Large marketplace outlet, but approval and upload workflows are not simple public API-first automation.",
      nextStep: "Use manager-approved designs for manual upload after risk review.",
      link: "https://merch.amazon.com/",
    },
  ];
}

function managerWorkplaceRecommendations(review, salesSignal) {
  const recommendations = [];

  if (!ETSY_API_KEY) {
    recommendations.push("Sales bottleneck: Etsy is still approval-gated. Use eBay research plus Shopify/Printify setup while waiting for ETSY_API_KEY.");
  }

  if (!PRINTIFY_API_TOKEN && !PRINTFUL_API_KEY) {
    recommendations.push("Production bottleneck: connect Printify or Printful next so approved designs can become product drafts instead of reports only.");
  }

  if (!SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_TOKEN) {
    recommendations.push("Revenue bottleneck: add a Shopify-owned storefront path so the team is not dependent on marketplace approval.");
  }

  recommendations.push("Design workflow: keep the Design agent focused on commercial art direction, product fit, and production notes for a human designer.");

  if (salesSignal?.status !== "active") {
    recommendations.push("Evidence quality: Sales agent needs a connected outlet API or it can only report proxy links, not richer listing evidence.");
  }

  if ((review.watchouts || []).length > 1) {
    recommendations.push("Risk workflow: add a stricter IP/saturation checklist before any product upload for this cycle.");
  }

  recommendations.push("Next workplace upgrade: add a Draft Product agent that turns approved briefs into Printify/Shopify draft payloads.");

  return recommendations.slice(0, 6);
}

async function fetchEtsySalesSignal(query, product) {
  const keyword = toSearchTerm(query, product);

  if (!ETSY_API_KEY) {
    return publicSalesFallback(query, product);
  }

  const url = new URL(ETSY_ACTIVE_LISTINGS_URL);
  url.searchParams.set("keywords", keyword);
  url.searchParams.set("limit", "8");
  url.searchParams.set("sort_on", "score");
  url.searchParams.set("includes", "Images,Shop");

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: "application/json",
          "x-api-key": ETSY_API_KEY,
          "User-Agent": "MerchTrendReviewAgent/1.0",
        },
      },
      "Etsy Open API",
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }

    const rawListings = payload.results || payload.data || [];
    const topListings = rawListings.slice(0, 5).map((listing) => ({
      id: listing.listing_id,
      title: compactText(listing.title, 92),
      url: listing.url || `https://www.etsy.com/listing/${listing.listing_id}`,
      shopName: listing.Shop?.shop_name || listing.shop?.shop_name || "",
      price: listingPrice(listing),
      favoriteCount: Number(listing.num_favorers || listing.favorers || 0),
      image: firstListingImage(listing),
      tags: (listing.tags || []).slice(0, 8),
    }));
    const prices = topListings
      .map((listing) => Number(String(listing.price).replace(/[^\d.]/g, "")))
      .filter((price) => Number.isFinite(price) && price > 0);
    const averagePrice = prices.length
      ? `USD ${(prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(2)}`
      : "";
    const favoriteTotal = topListings.reduce((sum, listing) => sum + (listing.favoriteCount || 0), 0);
    const scoreBoost = Math.min(12, Math.round(topListings.length + Math.min(7, favoriteTotal / 10)));
    const topTags = topTermsFromListings(rawListings);

    return {
      provider: "etsy",
      status: "active",
      query: keyword,
      summary: topListings.length
        ? `Etsy returned ${topListings.length} active listing proxies for "${keyword}"${averagePrice ? ` with average visible price ${averagePrice}` : ""}.`
        : `Etsy returned no active listing proxies for "${keyword}".`,
      listingCount: Number(payload.count || rawListings.length || topListings.length),
      averagePrice,
      topTags,
      topListings,
      scoreBoost,
      sourceLinks: [
        {
          label: "Etsy live marketplace search",
          url: `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`,
          type: "sales",
        },
        ...topListings.slice(0, 3).map((listing) => ({
          label: `Etsy proxy: ${listing.title}`,
          url: listing.url,
          type: "sales",
        })),
      ],
    };
  } catch (error) {
    console.error(`[etsy] ${error.message}`);
    const fallback = publicSalesFallback(query, product);
    fallback.summary = `Etsy sales proxy failed: ${error.message}`;
    return fallback;
  }
}

function reviewTrend(article) {
  const category = article.category
    ? {
        category: article.category,
        products: article.products || productCategories[categoryCursor % productCategories.length].products,
      }
    : productCategories[categoryCursor % productCategories.length];
  categoryCursor += 1;

  const title = article.title || "Untitled trend signal";
  const text = `${title} ${article.relatedHeadline || ""} ${article.source || ""}`.toLowerCase();
  const product = pickProduct(category.products || [], text);
  const productContext = `${category.category} / ${product}`;
  const popularityReasons = inferPopularityReasons(article, text, productContext);
  const graphicElements = inferGraphicElements(title, text, product);
  const imageResults = buildImageResults(article);
  const sourceLinks = buildSourceLinks(title, article);
  const specificResearch = buildSpecificResearch(article, product, category.category);
  const signals = [];
  const watchouts = [];
  let score = 58;
  const designFitScore = Number(article.commercialDesignScore || commercialDesignScore(article));

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

  if (designFitScore >= 6) {
    score += 8;
    signals.push(`Commercial design fit is strong (${designFitScore}/14): the topic has visual, product, fandom, lifestyle, or giftable hooks.`);
  } else {
    signals.push(`Commercial design fit is usable (${designFitScore}/14), but the designer should keep the concept broad and giftable.`);
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
    imageResults,
    sourceLinks,
    source: article.source || "Google Trends",
    market: TREND_GEO,
    evidence: article.traffic ? `Google Trends traffic: ${article.traffic}` : "Google Trends RSS placement",
    suitability: {
      status: "commercial-design-candidate",
      score: designFitScore,
      rejectedContentTypes: ["tragic news", "crime", "disaster", "death", "war", "legal/political news"],
      reason: "Selected because it has enough commercial design appeal and passed the safety filter.",
    },
    score,
    popularityReasons,
    graphicElements,
    specificResearch,
    designerBrief: buildDesignerBrief(title, product, popularityReasons, graphicElements),
    signals,
    watchouts,
    summary: `Demand signal: this topic is moving in ${TREND_GEO} search trends and passed the commercial design filter. Use it as inspiration for a ${product}, then validate marketplace saturation before producing. Keep the design original, avoid protected marks, and translate the theme into colors, typography, phrases, or motifs rather than copying source artwork.`,
  };
}

function buildImageResults(article) {
  if (!article.image) {
    const title = article.title || "Trend visual research";
    const encoded = encodeURIComponent(`${title} merch design trend`);
    const imageText = encodeURIComponent(compactText(title, 42));

    return [
      {
        title: `Visual research search: ${title}`,
        url: `https://placehold.co/900x600/07140c/00ff66/png?text=${imageText}`,
        source: "Visual research prompt",
        link: `https://www.google.com/search?tbm=isch&q=${encoded}`,
      },
    ];
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
    {
      label: "Amazon Merch outlet",
      url: "https://merch.amazon.com/",
      type: "outlet",
    },
    {
      label: "Printify product outlet",
      url: "https://printify.com/app/account/api",
      type: "outlet",
    },
    {
      label: "Printful product outlet",
      url: "https://developers.printful.com/",
      type: "outlet",
    },
  );

  return links;
}

function titleKeywords(title) {
  const stopWords = new Set([
    "and",
    "are",
    "for",
    "from",
    "into",
    "keep",
    "the",
    "this",
    "that",
    "with",
    "follow",
    "trending",
    "trend",
    "designs",
    "graphics",
  ]);

  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 7);
}

function topicProfile(title, text) {
  const keywords = titleKeywords(title);
  const joined = `${text} ${keywords.join(" ")}`;

  if (/\b(book|reading|reader|library|novel|romance)\b/.test(joined)) {
    return {
      buyer: "Book club hosts, romance/fantasy readers, librarians, and gift buyers shopping for reader identity products.",
      angle: "Make the design feel like a cozy reader badge rather than a generic quote graphic.",
      motif: "stacked books, annotated page tabs, tiny stars, tea or coffee cup, ribbon bookmark, and an arched club seal.",
      palette: "cream paper, oxblood, forest green, muted lavender, and one metallic-gold accent.",
      type: "serif headline paired with small handwritten marginalia or library-card microcopy.",
      phrase: "short phrases like Reading Era, Book Club Dept, Currently Booked, or Chapter One Energy.",
    };
  }

  if (/\b(farmers|market|produce|garden|tomato|fruit|kitchen)\b/.test(joined)) {
    return {
      buyer: "Farmers market shoppers, garden hobbyists, food-gift buyers, kitchen decor customers, and cottagecore audiences.",
      angle: "Turn the trend into a cheerful local-market identity system that can scale from stickers to mugs.",
      motif: "tomatoes, citrus, herbs, tote basket, hand-lettered price tags, gingham border, and sunburst produce badge.",
      palette: "tomato red, basil green, butter yellow, cream, and a small sky-blue highlight.",
      type: "friendly hand-painted script with a blocky market-stall sans for secondary words.",
      phrase: "short phrases like Market Day, Fresh Picked, Local Produce Club, or Tomato Season.",
    };
  }

  if (/\b(coquette|bow|pink|soft|ribbon|ballet)\b/.test(joined)) {
    return {
      buyer: "Gen Z gift buyers, fashion-aesthetic shoppers, bridal-party buyers, and soft-feminine apparel customers.",
      angle: "Keep it delicate and wearable, with the bow as the recognizable hook and the copy as the giftable twist.",
      motif: "ribbon bows, pearl dots, tiny hearts, lace frame, cameo oval, and a small handwritten label.",
      palette: "soft pink, ivory, cherry red, charcoal ink, and pale blue as a cooling accent.",
      type: "thin serif or fashion editorial type with small cursive details, avoiding childish bubble lettering.",
      phrase: "short phrases like Bow Dept, Soft Launch, Ribbon Club, or Pretty Little Routine.",
    };
  }

  if (/\b(drinkware|mug|coffee|tumbler|cup|personalized)\b/.test(joined)) {
    return {
      buyer: "Teacher-gift buyers, office coworkers, moms, bridesmaids, and customers looking for personalized daily-use gifts.",
      angle: "Lead with personalization and repeat-use utility, not a one-off novelty joke.",
      motif: "nameplate frame, small monogram, steam lines, desk icons, floral corners, and repeat pattern accents.",
      palette: "warm cream, espresso, sage, dusty rose, and a clear dark text color for names.",
      type: "clean rounded serif for names with compact sans labels that remain legible on curved surfaces.",
      phrase: "personalized copy like [Name]'s Cup, Desk Fuel, Daily Sip Club, or Morning Routine.",
    };
  }

  if (/\b(sport|sports|retro|varsity|pickleball|golf|club|team)\b/.test(joined)) {
    return {
      buyer: "Casual sports fans, recreational league players, dads, gym-class nostalgia buyers, and group-event shoppers.",
      angle: "Create a fictional club identity so it feels athletic without using protected team marks.",
      motif: "varsity crest, pennant, worn numbers, laurel, diagonal motion lines, and a small equipment icon.",
      palette: "faded navy, vintage cream, washed red, athletic gold, and dark green.",
      type: "condensed varsity block type with distressed edges and small collegiate sans labels.",
      phrase: "short phrases like Weekend League, Court Club, Varsity Dept, or Rec Team Original.",
    };
  }

  if (/\b(sticker|tote|fandom|aesthetic|microtrend)\b/.test(joined)) {
    return {
      buyer: "Sticker collectors, tote-bag shoppers, fandom-adjacent buyers, students, and aesthetic identity shoppers.",
      angle: "Package the idea as a collectible mini-world with multiple small icons instead of one vague graphic.",
      motif: "three-to-five icon set, label stickers, sparkle marks, tiny badge seals, and one strong central symbol.",
      palette: "cream base, black outline, one saturated accent, one pastel accent, and one neutral shadow color.",
      type: "small label-maker sans mixed with one expressive headline word.",
      phrase: "short phrases like Tiny Fandom Kit, Aesthetic Dept, Main Character Errands, or Sticker Club.",
    };
  }

  return {
    buyer: "Gift buyers and trend-aware shoppers who want a wearable or useful product that signals a current interest.",
    angle: "Translate the trend into an original identity badge, club mark, or phrase system rather than naming the source directly.",
    motif: `symbols pulled from ${keywords.slice(0, 4).join(", ") || "the trend mood"}, simplified into one readable focal mark.`,
    palette: "one dark ink, one warm neutral, one trend color, one contrast accent, and one quiet background color.",
    type: "bold readable headline type with a smaller supporting label that still works in thumbnail view.",
    phrase: `short, ownable phrases built around ${keywords.slice(0, 3).join(", ") || "the trend"} without protected names.`,
  };
}

function buildSpecificResearch(article, product, category) {
  const title = article.title || "Untitled trend signal";
  const text = trendArticleText(article);
  const keywords = titleKeywords(title);
  const profile = topicProfile(title, text);
  const baseQuery = keywords.length ? keywords.join(" ") : title;
  const productUse =
    product.includes("drinkware")
      ? "11oz mug, 15oz mug, travel tumbler, and wraparound repeat"
      : product.includes("sticker")
        ? "die-cut sticker, sticker sheet, tote-bag pocket print, and small phone-case mark"
        : product.includes("tote")
          ? "tote-bag center print, small chest tee, sticker, and poster"
          : "front graphic tee, comfort-colors style tee, sweatshirt, sticker, and tote";

  return {
    buyerProfile: profile.buyer,
    assignment: `${category} assignment: build one merch system for ${product}, then adapt it to ${productUse}.`,
    productAngle: profile.angle,
    visualTreatment: profile.motif,
    colorAndType: `${profile.palette} Use ${profile.type}`,
    copyDirection: profile.phrase,
    searchPhrases: [
      `${baseQuery} ${product}`,
      `${baseQuery} merch`,
      `${baseQuery} gift`,
      `${baseQuery} sticker`,
      `${baseQuery} mug`,
    ].slice(0, 5),
    productionNotes: [
      "Keep the main mark readable at 2 inches wide.",
      "Limit the first test to two-to-four print colors plus the garment or mug base.",
      "Avoid celebrity likenesses, protected team marks, logos, lyrics, and exact source artwork.",
      "Create one hero composition and one simplified secondary icon before expanding variants.",
    ],
  };
}

function inferPopularityReasons(article, text, productContext) {
  const reasons = [];
  const profile = topicProfile(article.title, text);

  if (article.traffic) {
    reasons.push(`Search volume is rising now (${article.traffic} in Google Trends), giving the design a current-awareness hook for ${profile.buyer}`);
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

  reasons.push(`Specific product fit: ${productContext}. ${profile.angle}`);

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
  const profile = topicProfile(title, title.toLowerCase());
  return `Design brief for ${product}: create an original merch direction around "${title}". Buyer: ${profile.buyer} Product angle: ${profile.angle} Visual treatment: ${profile.motif} Color/type: ${profile.palette} Use ${profile.type} Keep the design ownable, simple enough for print, and clear without protected marks.`;
}
function shouldRunAiAgents(trigger) {
  if (!OPENAI_API_KEY || OPENAI_AGENT_MODE === "off") {
    return false;
  }

  if (OPENAI_AGENT_MODE === "all") {
    return true;
  }

  return trigger === "manual";
}

function compactAgentInput(review, salesSignal) {
  return {
    title: review.title,
    product: review.product,
    category: review.category,
    market: review.market,
    score: review.score,
    evidence: review.evidence,
    source: review.source,
    reasons: (review.popularityReasons || []).slice(0, 4),
    graphics: (review.graphicElements || []).slice(0, 4),
    specificResearch: review.specificResearch,
    watchouts: (review.watchouts || []).slice(0, 4),
    sales: {
      status: salesSignal?.status,
      summary: salesSignal?.summary,
      listingCount: salesSignal?.listingCount,
      averagePrice: salesSignal?.averagePrice,
      tags: (salesSignal?.topTags || []).slice(0, 6),
      listings: (salesSignal?.topListings || []).slice(0, 3).map((listing) => ({
        title: listing.title,
        price: listing.price,
        favoriteCount: listing.favoriteCount,
      })),
    },
    outlets: outletCatalog(review.title, review.product).map((outlet) => ({
      name: outlet.name,
      status: outlet.status,
      nextStep: outlet.nextStep,
    })),
  };
}

function safeArray(value, fallback = []) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : fallback;
}

async function runAiAgentSynthesis(review, salesSignal, trigger) {
  if (!shouldRunAiAgents(trigger)) {
    review.agentRuntime = {
      status: OPENAI_API_KEY ? "standby" : "missing-key",
      mode: OPENAI_AGENT_MODE,
      model: OPENAI_MODEL,
      reason: OPENAI_API_KEY
        ? "OpenAI agents are configured for manual runs only to control token usage."
        : "OPENAI_API_KEY is not configured.",
    };
    return review;
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      demandReport: { type: "string" },
      salesReport: { type: "string" },
      designReport: { type: "string" },
      marketingReport: { type: "string" },
      riskReport: { type: "string" },
      managerDecision: { type: "string" },
      popularityReasons: { type: "array", items: { type: "string" }, maxItems: 5 },
      graphicElements: { type: "array", items: { type: "string" }, maxItems: 5 },
      marketingPlan: { type: "array", items: { type: "string" }, maxItems: 5 },
      workplaceRecommendations: { type: "array", items: { type: "string" }, maxItems: 5 },
      watchouts: { type: "array", items: { type: "string" }, maxItems: 5 },
      fruitScore: { type: "number" },
      shouldProceed: { type: "boolean" },
    },
    required: [
      "demandReport",
      "salesReport",
      "designReport",
      "marketingReport",
      "riskReport",
      "managerDecision",
      "popularityReasons",
      "graphicElements",
      "marketingPlan",
      "workplaceRecommendations",
      "watchouts",
      "fruitScore",
      "shouldProceed",
    ],
  };

  const input = [
    {
      role: "system",
      content:
        "You are the manager of a merch AI workplace. Produce concise, practical department reports for trend research, sales validation, design direction, marketing rollout, risk review, and a manager decision. Keep all design guidance original and avoid copying protected names, logos, characters, lyrics, or source artwork.",
    },
    {
      role: "user",
      content: JSON.stringify(compactAgentInput(review, salesSignal)),
    },
  ];

  try {
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        timeoutMs: 20000,
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input,
          max_output_tokens: OPENAI_AGENT_MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: "json_schema",
              name: "merch_agent_report",
              schema,
              strict: true,
            },
          },
        }),
      },
      "OpenAI agent runtime",
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message || payload.message || `HTTP ${response.status}`);
    }

    const text = payload.output_text || payload.output?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;
    const agentReport = JSON.parse(text || "{}");
    const aiMarketingPlan = safeArray(agentReport.marketingPlan);

    review.popularityReasons = safeArray(agentReport.popularityReasons, review.popularityReasons).slice(0, 5);
    review.graphicElements = safeArray(agentReport.graphicElements, review.graphicElements).slice(0, 5);
    review.watchouts = safeArray(agentReport.watchouts, review.watchouts).slice(0, 5);
    review.workplaceRecommendations = safeArray(
      agentReport.workplaceRecommendations,
      review.workplaceRecommendations,
    ).slice(0, 5);
    review.aiReports = {
      demand: compactText(agentReport.demandReport, 220),
      sales: compactText(agentReport.salesReport, 220),
      design: compactText(agentReport.designReport, 220),
      marketing: compactText(agentReport.marketingReport, 220),
      risk: compactText(agentReport.riskReport, 220),
      manager: compactText(agentReport.managerDecision, 240),
      shouldProceed: Boolean(agentReport.shouldProceed),
    };
    review.aiMarketingPlan = aiMarketingPlan;
    review.score = Math.max(1, Math.min(100, Math.round(Number(agentReport.fruitScore) || review.score)));
    review.summary = review.aiReports.manager || review.summary;
    review.agentRuntime = {
      status: "active",
      mode: OPENAI_AGENT_MODE,
      model: OPENAI_MODEL,
      maxOutputTokens: OPENAI_AGENT_MAX_OUTPUT_TOKENS,
    };
    return review;
  } catch (error) {
    console.error(`[openai-agents] ${error.message}`);
    review.agentRuntime = {
      status: "fallback",
      mode: OPENAI_AGENT_MODE,
      model: OPENAI_MODEL,
      error: error.message,
    };
    return review;
  }
}

function buildDesignPlan(review, salesSignal) {
  const projectType = /cup|mug|tumbler|drink/i.test(review.product)
    ? "drinkware"
    : /shirt|tee|apparel/i.test(review.product)
      ? "apparel"
      : "paraphernalia";
  const salesSummary = salesSignal?.summary || "Sales evidence is waiting for a configured marketplace connector.";
  const proofLevel =
    salesSignal?.status === "active" && salesSignal.topListings?.length
      ? "marketplace proxy found"
      : "needs marketplace proof";
  const topVisualCue = review.graphicElements?.[0] || "Create an original symbol system around the trend.";
  const topReason = review.popularityReasons?.[0] || review.signals?.[0] || "Current demand is moving.";
  const topTags = salesSignal?.topTags?.length ? salesSignal.topTags.slice(0, 5).join(", ") : "no marketplace tags yet";
  const salesOutlets = outletCatalog(review.title, review.product);
  const specifics = review.specificResearch || buildSpecificResearch(review, review.product, review.category);

  return {
    title: `Design direction board: ${review.title}`,
    projectType,
    proofLevel,
    direction: `${specifics.assignment} ${specifics.productAngle} Visual treatment: ${specifics.visualTreatment}`,
    salesSummary,
    salesOutlets,
    departments: {
      demand: review.aiReports?.demand || compactText(topReason, 160),
      sales: review.aiReports?.sales || salesSummary,
      design: review.aiReports?.design || compactText(topVisualCue, 160),
      marketing: review.aiReports?.marketing || "",
      risk: review.aiReports?.risk || review.watchouts?.[0] || "Avoid protected names, logos, lyrics, and source artwork.",
      manager: review.aiReports?.manager || "",
    },
    palette: ["#00ff66", "#ddffe9", "#c6ff6b", "#07140c", "#ff4f6d"],
    composition: [
      specifics.visualTreatment,
      specifics.colorAndType,
      specifics.copyDirection,
    ],
    marketingPlan: review.aiMarketingPlan?.length
      ? review.aiMarketingPlan.slice(0, 5)
      : [
          `Positioning: ${proofLevel}; lead with the trend mood, not protected names.`,
          `Audience test: ${specifics.buyerProfile} Compare against marketplace tags: ${topTags}.`,
          `Outlet ladder: start with ${salesOutlets[0].name}, validate POD with ${salesOutlets[1].name}, and keep Etsy/eBay as demand research until approved.`,
          "Offer ladder: launch one hero tee or mug, then adapt the same visual system to sticker/tote variants if the signal holds.",
          "Creative test: brief two typography variations and one illustrated-symbol variation before committing production time.",
        ],
    rollout: [
      "Research worker validates demand and current geography.",
      "Sales worker checks Etsy/eBay proxies plus Shopify, Printify, Printful, Gelato, and Amazon Merch outlet fit.",
      `Design worker writes art direction from: ${specifics.visualTreatment}`,
      "Risk worker removes protected marks and flags saturation or event-timing problems.",
      "Manager ships only if fruit score, sales proxy, and visual clarity all stay above threshold.",
    ],
  };
}

function enrichReviewWithSalesAndDesign(review, salesSignal) {
  const enriched = {
    ...review,
    sourceLinks: [...(review.sourceLinks || [])],
    imageResults: [...(review.imageResults || [])],
    popularityReasons: [...(review.popularityReasons || [])],
    graphicElements: [...(review.graphicElements || [])],
    specificResearch: review.specificResearch,
    watchouts: [...(review.watchouts || [])],
  };

  enriched.salesSignal = salesSignal;
  enriched.sourceLinks.push(...(salesSignal.sourceLinks || []));

  (salesSignal.topListings || []).forEach((listing) => {
    if (listing.image) {
      enriched.imageResults.push({
        title: listing.title,
        url: listing.image,
        source: "Etsy sales proxy",
        link: listing.url,
      });
    }
  });

  if (salesSignal.status === "active" && salesSignal.topListings?.length) {
    enriched.score = Math.min(100, enriched.score + salesSignal.scoreBoost);
    enriched.popularityReasons.push(
      `${salesSignal.summary} Treat this as marketplace proof of listing competition and visual direction, not verified sold volume.`,
    );
  } else {
    enriched.watchouts.push(salesSignal.summary);
  }

  if (salesSignal.topTags?.length) {
    enriched.graphicElements.push(`Marketplace tag language to consider: ${salesSignal.topTags.slice(0, 6).join(", ")}.`);
  }

  enriched.designPlan = buildDesignPlan(enriched, salesSignal);
  enriched.salesOutlets = enriched.designPlan.salesOutlets;
  enriched.workplaceRecommendations = managerWorkplaceRecommendations(enriched, salesSignal);
  enriched.designerBrief = `${enriched.designerBrief} Sales worker: ${salesSignal.summary} Design worker: write art direction, product notes, and a rollout plan; do not generate artwork.`;

  return enriched;
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
      commercialDesignScore: 8,
    },
    {
      category: "Cups",
      products: ["ceramic mug", "travel tumbler"],
      title: "Personalized drinkware remains a strong gifting category",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
      commercialDesignScore: 8,
    },
    {
      category: "Merch",
      products: ["sticker pack", "tote bag"],
      title: "Sticker and tote designs follow fandom and aesthetic microtrends",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
      commercialDesignScore: 7,
    },
    {
      category: "T-shirts",
      products: ["graphic tee", "oversized shirt"],
      title: "Coquette bow graphics and soft pink typography keep selling on giftable apparel",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
      commercialDesignScore: 9,
    },
    {
      category: "Cups",
      products: ["travel tumbler", "ceramic mug"],
      title: "Book club and reading era phrases are strong for mugs and tote bags",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
      commercialDesignScore: 9,
    },
    {
      category: "Merch",
      products: ["sticker pack", "phone case", "poster"],
      title: "Farmers market produce illustrations are working across stickers and kitchen gifts",
      source: "fallback.local",
      url: "#",
      image: "",
      traffic: "fallback",
      commercialDesignScore: 8,
    },
  ];
}

async function handleReview(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const force = url.searchParams.get("trigger") === "manual";
    const articles = await loadTrendArticles(force);
    const article = selectNextTrendArticle(articles);

    const trigger = force ? "manual" : url.searchParams.get("trigger") || "scheduled";
    const baseReview = reviewTrend(article);
    const salesSignal = await fetchEtsySalesSignal(baseReview.title, baseReview.product);
    const review = await runAiAgentSynthesis(
      enrichReviewWithSalesAndDesign(baseReview, salesSignal),
      salesSignal,
      trigger,
    );
    review.designPlan = buildDesignPlan(review, salesSignal);
    review.salesOutlets = review.designPlan.salesOutlets;
    latestDesignBrief = {
      review,
      salesSignal,
      designBrief: review.designPlan,
      updatedAt: new Date().toISOString(),
    };

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

async function handleSales(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const query = url.searchParams.get("query") || "graphic tee";
    const product = url.searchParams.get("product") || "merch design";
    const salesSignal = await fetchEtsySalesSignal(query, product);

    sendJson(response, 200, {
      ok: true,
      salesSignal,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[api/sales] ${error.message}`);
    sendJson(response, 502, {
      ok: false,
      error: error.message,
    });
  }
}

function handleOutlets(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const query = url.searchParams.get("query") || "graphic tee";
  const product = url.searchParams.get("product") || "merch design";

  sendJson(response, 200, {
    ok: true,
    outlets: outletCatalog(query, product),
  });
}

function fallbackDesignBrief() {
  const review = {
    category: "T-shirts",
    product: "graphic tee",
    title: "Waiting for first trend review",
    score: 0,
    popularityReasons: ["Demand worker is waiting for the next trend scan."],
    graphicElements: ["Design worker will write the first visual direction after a review."],
    watchouts: ["Connect Etsy and review the first trend before production."],
  };
  const salesSignal = publicSalesFallback(review.title, review.product);

  return {
    review,
    salesSignal,
    designBrief: buildDesignPlan(review, salesSignal),
    updatedAt: new Date().toISOString(),
  };
}

function currentDesignPackage() {
  return latestDesignBrief || fallbackDesignBrief();
}

function handleDesignBrief(request, response) {
  sendJson(response, 200, {
    ok: true,
    ...currentDesignPackage(),
  });
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

  if (request.method === "GET" && url.pathname === "/api/sales") {
    handleSales(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/outlets") {
    handleOutlets(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/design-brief") {
    handleDesignBrief(request, response);
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

  response.writeHead(405, { Allow: "GET, POST" });
  response.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Merch Trend Review Agent running at http://127.0.0.1:${PORT}`);
});
