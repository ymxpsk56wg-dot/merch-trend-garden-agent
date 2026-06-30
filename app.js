const REVIEW_INTERVAL_MS = 10 * 60 * 1000;
const API_BASE_URL = window.location.protocol === "file:" ? "http://127.0.0.1:4173" : "";

const state = {
  reviewed: 0,
  nextRunAt: Date.now() + REVIEW_INTERVAL_MS,
  loading: false,
  lastReview: null,
  history: [],
  selectedHistoryId: null,
  countdownTimerId: null,
  missionTimerIds: [],
};

const statusText = document.querySelector("#statusText");
const statusPill = document.querySelector("#statusPill");
const agentTask = document.querySelector("#agentTask");
const officeScene = document.querySelector("#officeScene");
const carryCard = document.querySelector("#carryCard");
const boardScore = document.querySelector("#boardScore");
const boardCategory = document.querySelector("#boardCategory");
const boardTitle = document.querySelector("#boardTitle");
const boardProduct = document.querySelector("#boardProduct");
const monitorText = document.querySelector("#monitorText");
const listingTitle = document.querySelector("#listingTitle");
const listingLink = document.querySelector("#listingLink");
const imageResultLink = document.querySelector("#imageResultLink");
const imageResult = document.querySelector("#imageResult");
const imageResultFallback = document.querySelector("#imageResultFallback");
const imageResultCaption = document.querySelector("#imageResultCaption");
const reviewScore = document.querySelector("#reviewScore");
const listingPrice = document.querySelector("#listingPrice");
const sourceMode = document.querySelector("#sourceMode");
const marketText = document.querySelector("#marketText");
const summaryText = document.querySelector("#summaryText");
const reasonList = document.querySelector("#reasonList");
const elementList = document.querySelector("#elementList");
const sourceLinkList = document.querySelector("#sourceLinkList");
const watchoutList = document.querySelector("#watchoutList");
const reviewNowButton = document.querySelector("#reviewNowButton");
const reviewCount = document.querySelector("#reviewCount");
const nextRun = document.querySelector("#nextRun");
const countdownValue = document.querySelector("#countdownValue");
const progressFill = document.querySelector("#progressFill");
const eventLog = document.querySelector("#eventLog");
const apiSourceList = document.querySelector("#apiSourceList");

function formatClock(date) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(ms) {
  const remaining = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timerId = window.setTimeout(resolve, ms);
    state.missionTimerIds.push(timerId);
  });
}

function clearMissionTimers() {
  state.missionTimerIds.forEach((timerId) => window.clearTimeout(timerId));
  state.missionTimerIds = [];
}

function setStatus(label, mode = "ready") {
  statusText.textContent = label;
  statusPill.dataset.mode = mode;
}

function sourceLabel(source) {
  const labels = {
    "google-trends": "Google Trends",
    gdelt: "GDELT",
    ebay: "eBay Browse",
    etsy: "Etsy Open API",
    youtube: "YouTube Data API",
    fallback: "Fallback",
  };

  return labels[source] || source || "Unknown";
}

function setAgentState(phase, label) {
  officeScene.dataset.agentState = phase;
  agentTask.textContent = label;
  monitorText.textContent = phase === "researching" ? "LOOKUP..." : "TREND DB";
  carryCard.textContent = phase === "to-board" || phase === "posting" ? "TREND" : "";
}

function setList(list, items, fallback) {
  list.replaceChildren();
  const values = items?.length ? items : [fallback];

  values.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  });
}

function setSourceLinks(list, links) {
  list.replaceChildren();
  const values = links?.length
    ? links
    : [{ label: "No source links available", url: "#", type: "source" }];

  values.forEach((link) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");

    anchor.href = link.url || "#";
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = link.label || "Open research link";
    item.dataset.type = link.type || "source";
    item.append(anchor);
    list.append(item);
  });
}

function renderImageResult(review) {
  const result = review.imageResults?.[0];
  const imageUrl = result?.url || review.image;
  const linkUrl = result?.link || review.url || "#";

  imageResultLink.href = linkUrl;

  if (imageUrl) {
    imageResult.src = imageUrl;
    imageResult.alt = result?.title || review.title;
    imageResult.hidden = false;
    imageResultFallback.hidden = true;
    imageResultCaption.textContent = `${result?.source || review.source || "Source"} image for visual research. Use it for mood and composition only; do not copy artwork.`;
    return;
  }

  imageResult.removeAttribute("src");
  imageResult.alt = "";
  imageResult.hidden = true;
  imageResultFallback.hidden = false;
  imageResultCaption.textContent = "No source image was provided by this feed. Use the research links to inspect visual references manually.";
}

function createHistoryEntry(payload) {
  return {
    id: `${Date.now()}-${state.history.length}`,
    createdAt: new Date().toISOString(),
    source: payload.source,
    query: payload.query,
    market: payload.market,
    review: payload.review,
  };
}

function renderReview(payload) {
  const entry = createHistoryEntry(payload);

  state.history.unshift(entry);

  while (state.history.length > 12) {
    state.history.pop();
  }

  state.reviewed = state.history.length;
  state.selectedHistoryId = entry.id;
  renderReviewEntry(entry);
  renderEventLog();
}

function renderReviewEntry(entry) {
  const review = entry.review;
  state.lastReview = review;

  listingTitle.textContent = review.title;
  listingLink.href = review.url || "#";
  reviewScore.textContent = `${review.score}/100`;
  listingPrice.textContent = review.product || "Merch design";
  sourceMode.textContent = sourceLabel(entry.source);
  marketText.textContent = review.market || entry.market || "US";
  summaryText.textContent = review.designerBrief || review.summary;
  reviewCount.textContent = state.reviewed;
  renderImageResult(review);

  boardScore.textContent = `${review.score}`;
  boardCategory.textContent = review.category || entry.query || "Trend";
  boardTitle.textContent = review.title;
  boardProduct.textContent = review.product || "Merch design";

  setList(reasonList, review.popularityReasons || review.signals, "No popularity reasoning found in the trend metadata.");
  setList(elementList, review.graphicElements, "No graphical elements were inferred yet.");
  setSourceLinks(sourceLinkList, review.sourceLinks);
  setList(watchoutList, review.watchouts, "No obvious watchouts from the trend metadata.");
}

function renderEventLog() {
  eventLog.replaceChildren();

  state.history.forEach((entry) => {
    const review = entry.review;
    const item = document.createElement("li");
    const button = document.createElement("button");
    const category = document.createElement("strong");
    const title = document.createElement("span");
    const meta = document.createElement("time");

    button.type = "button";
    button.dataset.reviewId = entry.id;
    button.className = entry.id === state.selectedHistoryId ? "is-selected" : "";
    category.textContent = review.category || "Trend";
    title.textContent = review.title;
    meta.textContent = `${review.score}/100 · ${review.product || "merch"} · ${review.market || "US"} · ${sourceLabel(entry.source)} · ${formatClock(new Date(entry.createdAt))}`;

    button.append(category, title, meta);
    item.append(button);
    eventLog.append(item);
  });
}

function renderApiSources(sources) {
  if (!apiSourceList) {
    return;
  }

  apiSourceList.replaceChildren();

  sources.forEach((source) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    const setup = document.createElement("small");

    item.dataset.status = source.status;
    name.textContent = source.name;
    meta.textContent = `${source.statusLabel} · ${source.signal}`;
    setup.textContent = source.setup;
    item.append(name, meta, setup);
    apiSourceList.append(item);
  });
}

async function loadApiSources() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sources`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    renderApiSources(payload.sources || []);
  } catch {
    renderApiSources([
      {
        name: "Google Trends RSS",
        status: "active",
        statusLabel: "Live",
        signal: "Realtime search demand",
        setup: "No key required",
      },
    ]);
  }
}

function renderCountdown() {
  const now = Date.now();
  const remaining = state.nextRunAt - now;
  const elapsed = REVIEW_INTERVAL_MS - Math.max(0, remaining);
  const progress = Math.min(100, Math.max(0, (elapsed / REVIEW_INTERVAL_MS) * 100));

  countdownValue.textContent = formatDuration(remaining);
  progressFill.style.width = `${progress}%`;
  nextRun.textContent = formatClock(new Date(state.nextRunAt));

  if (remaining <= 0 && !state.loading) {
    runReview("scheduled");
  }
}

async function fetchReview(trigger) {
  const response = await fetch(`${API_BASE_URL}/api/review?trigger=${encodeURIComponent(trigger)}`, {
    headers: { Accept: "application/json" },
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    throw new Error(payload.error || "Review request failed.");
  }

  return payload;
}

async function runReview(trigger) {
  if (state.loading) {
    return;
  }

  state.loading = true;
  clearMissionTimers();
  reviewNowButton.disabled = true;
  setStatus(trigger === "manual" ? "Reviewing now" : "Reviewing", "loading");

  try {
    setAgentState("to-desk", "Walking to desk");
    await sleep(900);

    setAgentState("researching", "Looking up top trend");
    const payload = await fetchReview(trigger);
    await sleep(700);

    setAgentState("to-board", "Carrying trend to board");
    await sleep(1100);

    setAgentState("posting", "Posting to board");
    renderReview(payload);
    await sleep(500);

    setAgentState("idle", "Standing by");
    setStatus(sourceLabel(payload.source), payload.source);
  } catch (error) {
    setAgentState("idle", "Review failed");
    setStatus("Review failed", "error");
    summaryText.textContent = explainFetchError(error);
  } finally {
    state.loading = false;
    reviewNowButton.disabled = false;
    state.nextRunAt = Date.now() + REVIEW_INTERVAL_MS;
    renderCountdown();
  }
}

function explainFetchError(error) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "Could not reach /api/review. Run the Node server with npm run dev, open http://127.0.0.1:4173, and deploy this as a Node app rather than a static-only site.";
  }

  return error.message;
}

reviewNowButton.addEventListener("click", () => {
  runReview("manual");
});

eventLog.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-review-id]");

  if (!button) {
    return;
  }

  const entry = state.history.find((historyEntry) => historyEntry.id === button.dataset.reviewId);

  if (!entry) {
    return;
  }

  state.selectedHistoryId = entry.id;
  renderReviewEntry(entry);
  renderEventLog();
  setAgentState("idle", "Reviewing archive");
  setStatus("Archive view", "ready");
});

state.countdownTimerId = window.setInterval(renderCountdown, 1000);
renderCountdown();
loadApiSources();
runReview("initial");
