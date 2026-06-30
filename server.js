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
      id: "figma",
      name: "Figma design department",
      status: "plugin-ready",
      statusLabel: "Plugin ready",
      signal: "Creates a Figma concept board from the manager direction, sales proxy, design cues, and marketing plan",
      setup: "Install the generated plugin from /figma-plugin/manifest.json. Optional REST read/export can use FIGMA_ACCESS_TOKEN and FIGMA_FILE_KEY.",
      where: "Design workflow",
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
        ? "Use the approved Figma artwork to generate POD product drafts."
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

function figmaConnectionStatus() {
  const restConfigured = Boolean(process.env.FIGMA_ACCESS_TOKEN && process.env.FIGMA_FILE_KEY);

  return {
    status: restConfigured ? "rest-connected" : "plugin-ready",
    pluginManifestUrl: `${PUBLIC_SITE_URL}/figma-plugin/manifest.json`,
    pluginCodeUrl: `${PUBLIC_SITE_URL}/figma-plugin/code.js`,
    fileKey: process.env.FIGMA_FILE_KEY || "",
    nextSteps: restConfigured
      ? [
          "Figma REST token and file key are configured for file read/export checks.",
          "Run the hosted Figma plugin inside your Figma account to create editable design boards.",
        ]
      : [
          "Install the hosted Figma plugin from the manifest URL.",
          "Run the plugin inside Figma; it fetches /api/design-brief and creates the editable concept board in your account.",
          "Optional: add FIGMA_ACCESS_TOKEN and FIGMA_FILE_KEY for REST status checks.",
        ],
  };
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

  if (!process.env.FIGMA_ACCESS_TOKEN || !process.env.FIGMA_FILE_KEY) {
    recommendations.push("Design workflow: use the Figma plugin now, then add FIGMA_ACCESS_TOKEN and FIGMA_FILE_KEY for account/file status checks.");
  }

  if (salesSignal?.status !== "active") {
    recommendations.push("Evidence quality: Sales agent needs a connected outlet API or it can only report proxy links, not richer listing evidence.");
  }

  if ((review.watchouts || []).length > 1) {
    recommendations.push("Risk workflow: add a stricter IP/saturation checklist before any product upload for this cycle.");
  }

  recommendations.push("Next workplace upgrade: add a Draft Product agent that takes manager-approved Figma outputs and creates Printify/Shopify draft payloads.");

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
  const figmaConnection = figmaConnectionStatus();

  return {
    title: `Figma concept board: ${review.title}`,
    projectType,
    proofLevel,
    direction: `Create an original ${review.product} concept for "${review.title}" using ${compactText(topVisualCue, 160).toLowerCase()}`,
    salesSummary,
    figmaPlugin: {
      manifestUrl: figmaConnection.pluginManifestUrl,
      codeUrl: figmaConnection.pluginCodeUrl,
      status: "plugin-ready",
    },
    figmaConnection,
    salesOutlets,
    departments: {
      demand: compactText(topReason, 160),
      sales: salesSummary,
      design: compactText(topVisualCue, 160),
      risk: review.watchouts?.[0] || "Avoid protected names, logos, lyrics, and source artwork.",
    },
    palette: ["#00ff66", "#ddffe9", "#c6ff6b", "#07140c", "#ff4f6d"],
    composition: [
      projectType === "drinkware"
        ? "Vertical badge or wraparound repeat that remains readable on a curved surface."
        : "Center-front composition with one strong focal mark and readable short-form type.",
      "Two-to-four print colors with one accent color reserved for urgency or proof.",
      "Thick outline or boxed type treatment so the idea works as a thumbnail and on product mockups.",
    ],
    marketingPlan: [
      `Positioning: ${proofLevel}; lead with the trend mood, not protected names.`,
      `Audience test: buyers already searching "${review.category}" plus marketplace tags: ${topTags}.`,
      `Outlet ladder: start with ${salesOutlets[0].name}, validate POD with ${salesOutlets[1].name}, and keep Etsy/eBay as demand research until approved.`,
      "Offer ladder: launch one hero tee or mug, then adapt the same visual system to sticker/tote variants if the signal holds.",
      "Creative test: produce two typography variations and one illustrated-symbol variation before committing production time.",
    ],
    rollout: [
      "Research worker validates demand and current geography.",
      "Sales worker checks Etsy/eBay proxies plus Shopify, Printify, Printful, Gelato, and Amazon Merch outlet fit.",
      "Design worker creates the Figma concept board and first layout options in your Figma account through the hosted plugin.",
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
  enriched.figmaConnection = enriched.designPlan.figmaConnection;
  enriched.workplaceRecommendations = managerWorkplaceRecommendations(enriched, salesSignal);
  enriched.designerBrief = `${enriched.designerBrief} Sales worker: ${salesSignal.summary} Figma worker: use the design-plan plugin to create the concept board and rollout plan.`;

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

    const baseReview = reviewTrend(article);
    const salesSignal = await fetchEtsySalesSignal(baseReview.title, baseReview.product);
    const review = enrichReviewWithSalesAndDesign(baseReview, salesSignal);
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
    figmaConnection: figmaConnectionStatus(),
  });
}

function fallbackDesignBrief() {
  const review = {
    category: "T-shirts",
    product: "graphic tee",
    title: "Waiting for first trend review",
    score: 0,
    popularityReasons: ["Demand worker is waiting for the next trend scan."],
    graphicElements: ["Design worker will generate the first visual system after a review."],
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

function handleDesignBrief(request, response) {
  sendJson(response, 200, {
    ok: true,
    ...(latestDesignBrief || fallbackDesignBrief()),
  });
}

async function handleFigmaStatus(request, response) {
  const status = {
    ok: true,
    plugin: {
      status: "ready",
      manifestUrl: `${PUBLIC_SITE_URL}/figma-plugin/manifest.json`,
      codeUrl: `${PUBLIC_SITE_URL}/figma-plugin/code.js`,
    },
    rest: {
      status: process.env.FIGMA_ACCESS_TOKEN && process.env.FIGMA_FILE_KEY ? "configured" : "optional",
      setup: "Set FIGMA_ACCESS_TOKEN and FIGMA_FILE_KEY only if you want REST read/export checks. Creating designs is handled by the plugin.",
    },
  };

  if (!process.env.FIGMA_ACCESS_TOKEN || !process.env.FIGMA_FILE_KEY) {
    sendJson(response, 200, status);
    return;
  }

  try {
    const figmaUrl = new URL(`https://api.figma.com/v1/files/${process.env.FIGMA_FILE_KEY}`);
    figmaUrl.searchParams.set("depth", "1");
    const figmaResponse = await fetchWithTimeout(
      figmaUrl,
      {
        headers: {
          Accept: "application/json",
          "X-Figma-Token": process.env.FIGMA_ACCESS_TOKEN,
        },
      },
      "Figma REST API",
    );
    const payload = await figmaResponse.json();

    status.rest.status = figmaResponse.ok ? "configured" : "error";
    status.rest.fileName = payload.name || "";
    status.rest.error = figmaResponse.ok ? "" : payload.err || payload.message || `HTTP ${figmaResponse.status}`;
    sendJson(response, figmaResponse.ok ? 200 : 502, status);
  } catch (error) {
    status.rest.status = "error";
    status.rest.error = error.message;
    sendJson(response, 502, status);
  }
}

function sendText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

function getRequestOrigin(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host;

  if (host) {
    return `${proto}://${host}`;
  }

  return PUBLIC_SITE_URL;
}

function handleFigmaPluginManifest(request, response) {
  const origin = getRequestOrigin(request);

  sendText(
    response,
    200,
    JSON.stringify(
      {
        name: "Merch Trend Matrix Design Department",
        id: "merch-trend-matrix-design-department",
        api: "1.0.0",
        main: "code.js",
        editorType: ["figma"],
        networkAccess: {
          allowedDomains: [origin, PUBLIC_SITE_URL],
        },
      },
      null,
      2,
    ),
    "application/json; charset=utf-8",
  );
}

function figmaPluginCode(apiBaseUrl) {
  return `
const API_BASE_URL = ${JSON.stringify(apiBaseUrl)};
const FONT = { family: "Inter", style: "Regular" };
const BOLD_FONT = { family: "Inter", style: "Bold" };

function rgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}

function paint(hex) {
  return [{ type: "SOLID", color: rgb(hex) }];
}

async function addText(parent, text, x, y, width, size, fills, fontName = FONT) {
  const node = figma.createText();
  await figma.loadFontAsync(fontName);
  node.fontName = fontName;
  node.characters = text || "";
  node.fontSize = size;
  node.lineHeight = { unit: "PERCENT", value: 125 };
  node.resize(width, Math.max(24, size * 1.6));
  node.x = x;
  node.y = y;
  node.fills = fills;
  parent.appendChild(node);
  return node;
}

function addPanel(parent, x, y, width, height, fill, stroke) {
  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.fills = paint(fill);
  rect.strokes = paint(stroke);
  rect.strokeWeight = 2;
  parent.appendChild(rect);
  return rect;
}

async function main() {
  await figma.loadFontAsync(FONT);
  await figma.loadFontAsync(BOLD_FONT);
  const response = await fetch(API_BASE_URL + "/api/design-brief");
  const payload = await response.json();
  const design = payload.designBrief;
  const review = payload.review;

  const frame = figma.createFrame();
  frame.name = "Merch Trend Matrix - " + (review.title || "Design Brief");
  frame.resize(1440, 1100);
  frame.fills = paint("#07140c");
  frame.x = figma.viewport.center.x - 720;
  frame.y = figma.viewport.center.y - 510;

  await addText(frame, "MERCH TREND MATRIX", 56, 48, 800, 42, paint("#00ff66"), BOLD_FONT);
  await addText(frame, review.title || "Trend concept", 56, 108, 900, 26, paint("#ddffe9"), BOLD_FONT);
  await addText(frame, design.direction, 56, 154, 860, 20, paint("#ddffe9"));

  addPanel(frame, 56, 230, 410, 220, "#020403", "#00ff66");
  await addText(frame, "DEMAND", 82, 258, 300, 20, paint("#c6ff6b"), BOLD_FONT);
  await addText(frame, design.departments.demand, 82, 300, 330, 18, paint("#ddffe9"));

  addPanel(frame, 514, 230, 410, 220, "#020403", "#00ff66");
  await addText(frame, "SALES", 540, 258, 300, 20, paint("#c6ff6b"), BOLD_FONT);
  await addText(frame, design.departments.sales, 540, 300, 330, 18, paint("#ddffe9"));

  addPanel(frame, 972, 230, 410, 220, "#020403", "#00ff66");
  await addText(frame, "RISK", 998, 258, 300, 20, paint("#c6ff6b"), BOLD_FONT);
  await addText(frame, design.departments.risk, 998, 300, 330, 18, paint("#ddffe9"));

  addPanel(frame, 56, 500, 630, 300, "#020403", "#28ff8a");
  await addText(frame, "COMPOSITION", 82, 528, 400, 22, paint("#00ff66"), BOLD_FONT);
  await addText(frame, design.composition.map((item) => "- " + item).join("\\n"), 82, 578, 540, 18, paint("#ddffe9"));

  addPanel(frame, 744, 500, 638, 300, "#020403", "#28ff8a");
  await addText(frame, "MARKETING PLAN", 770, 528, 420, 22, paint("#00ff66"), BOLD_FONT);
  await addText(frame, design.marketingPlan.map((item) => "- " + item).join("\\n"), 770, 578, 540, 18, paint("#ddffe9"));

  await addText(frame, "SALES OUTLETS", 56, 830, 360, 22, paint("#c6ff6b"), BOLD_FONT);
  await addText(frame, (design.salesOutlets || []).slice(0, 5).map((outlet) => "- " + outlet.name + ": " + outlet.nextStep).join("\\n"), 56, 876, 460, 16, paint("#ddffe9"));

  await addText(frame, "MANAGER UPDATES", 590, 830, 360, 22, paint("#c6ff6b"), BOLD_FONT);
  await addText(frame, (review.workplaceRecommendations || []).slice(0, 4).map((item) => "- " + item).join("\\n"), 590, 876, 730, 16, paint("#ddffe9"));

  await addText(frame, "PRINT PALETTE", 56, 972, 300, 22, paint("#c6ff6b"), BOLD_FONT);
  design.palette.forEach((hex, index) => {
    const swatch = figma.createRectangle();
    swatch.x = 56 + index * 88;
    swatch.y = 1016;
    swatch.resize(54, 54);
    swatch.fills = paint(hex);
    swatch.strokes = paint("#ddffe9");
    frame.appendChild(swatch);
  });

  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.closePlugin("Design department board created from the latest trend.");
}

main().catch((error) => {
  figma.closePlugin("Figma hookup failed: " + error.message);
});
`.trimStart();
}

function handleFigmaPluginCode(request, response) {
  sendText(response, 200, figmaPluginCode(getRequestOrigin(request)), "application/javascript; charset=utf-8");
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

  if (request.method === "GET" && url.pathname === "/api/figma/status") {
    handleFigmaStatus(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/figma-plugin/manifest.json") {
    handleFigmaPluginManifest(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/figma-plugin/code.js") {
    handleFigmaPluginCode(request, response);
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
