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
  managerFeed: [],
};

const statusText = document.querySelector("#statusText");
const statusPill = document.querySelector("#statusPill");
const agentTask = document.querySelector("#agentTask");
const officeScene = document.querySelector("#officeScene");
const boardScore = document.querySelector("#boardScore");
const boardCategory = document.querySelector("#boardCategory");
const boardTitle = document.querySelector("#boardTitle");
const listingTitle = document.querySelector("#listingTitle");
const listingLink = document.querySelector("#listingLink");
const imageResultLink = document.querySelector("#imageResultLink");
const imageResult = document.querySelector("#imageResult");
const imageResultFallback = document.querySelector("#imageResultFallback");
const listingPrice = document.querySelector("#listingPrice");
const sourceMode = document.querySelector("#sourceMode");
const marketText = document.querySelector("#marketText");
const summaryText = document.querySelector("#summaryText");
const reasonList = document.querySelector("#reasonList");
const elementList = document.querySelector("#elementList");
const marketingPlanList = document.querySelector("#marketingPlanList");
const sourceLinkList = document.querySelector("#sourceLinkList");
const watchoutList = document.querySelector("#watchoutList");
const reviewNowButton = document.querySelector("#reviewNowButton");
const reviewCount = document.querySelector("#reviewCount");
const nextRun = document.querySelector("#nextRun");
const countdownValue = document.querySelector("#countdownValue");
const progressFill = document.querySelector("#progressFill");
const eventLog = document.querySelector("#eventLog");
const apiSourceList = document.querySelector("#apiSourceList");
const managerFeed = document.querySelector("#managerFeed");
const managerDirective = document.querySelector("#managerDirective");
const managerReason = document.querySelector("#managerReason");
const demandRoomStatus = document.querySelector("#demandRoomStatus");
const marketRoomStatus = document.querySelector("#marketRoomStatus");
const salesRoomStatus = document.querySelector("#salesRoomStatus");
const designRoomStatus = document.querySelector("#designRoomStatus");
const marketingRoomStatus = document.querySelector("#marketingRoomStatus");
const riskRoomStatus = document.querySelector("#riskRoomStatus");
const demandReport = document.querySelector("#demandReport");
const marketReport = document.querySelector("#marketReport");
const salesReport = document.querySelector("#salesReport");
const designReport = document.querySelector("#designReport");
const marketingReport = document.querySelector("#marketingReport");
const riskReport = document.querySelector("#riskReport");
const designPlanList = document.querySelector("#designPlanList");
const agentCards = document.querySelectorAll("[data-agent]");

const agents = {
  demand: {
    label: "Demand agent",
    active: "Reading search velocity",
    idle: "Watching trend velocity",
  },
  market: {
    label: "Market agent",
    active: "Checking marketplace context",
    idle: "Mapping where it is selling",
  },
  sales: {
    label: "Sales agent",
    active: "Pulling sales proxy",
    idle: "Checking Etsy proxy",
  },
  design: {
    label: "Design agent",
    active: "Drafting Figma direction",
    idle: "Preparing Figma direction",
  },
  marketing: {
    label: "Marketing agent",
    active: "Building launch plan",
    idle: "Building launch plan",
  },
  risk: {
    label: "Risk agent",
    active: "Reviewing constraints",
    idle: "Scanning watchouts",
  },
  manager: {
    label: "Manager agent",
    active: "Synthesizing decision",
    idle: "Reporting progress",
  },
};

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

function shortText(value, fallback, maxLength = 120) {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function getFruitScore(review) {
  const sourceDepth = Math.min(10, (review.sourceLinks?.length || 0) * 2);
  const reasoningDepth = Math.min(10, (review.popularityReasons?.length || review.signals?.length || 0) * 2);
  const imageSignal = review.image || review.imageResults?.length ? 6 : 0;
  const designDepth = Math.min(8, (review.graphicElements?.length || 0) * 2);
  const salesDepth = review.salesSignal?.status === "active" ? 8 : 0;
  const baseScore = Number(review.score) || 0;

  return Math.min(100, Math.round(baseScore * 0.7 + sourceDepth + reasoningDepth + imageSignal + designDepth + salesDepth));
}

function getFruitTier(score) {
  if (score >= 82) {
    return "high";
  }

  if (score >= 64) {
    return "medium";
  }

  return "low";
}

function setAgentStatus(agentKey, status = "idle", label) {
  const card = document.querySelector(`[data-agent="${agentKey}"]`);

  if (!card) {
    return;
  }

  card.dataset.status = status;
  const statusTarget = {
    demand: demandRoomStatus,
    market: marketRoomStatus,
    sales: salesRoomStatus,
    design: designRoomStatus,
    marketing: marketingRoomStatus,
    risk: riskRoomStatus,
  }[agentKey];

  if (statusTarget && label) {
    statusTarget.textContent = label;
  }
}

function setAllAgents(status = "idle") {
  agentCards.forEach((card) => {
    const key = card.dataset.agent;
    card.dataset.status = status;
    if (status === "idle" && agents[key]) {
      const statusTarget = {
        demand: demandRoomStatus,
        market: marketRoomStatus,
        sales: salesRoomStatus,
        design: designRoomStatus,
        marketing: marketingRoomStatus,
        risk: riskRoomStatus,
      }[key];

      if (statusTarget && agents[key].idle) {
        statusTarget.textContent = agents[key].idle;
      }
    }
  });
}

function addManagerFeed(message) {
  state.managerFeed.unshift(`${formatClock(new Date())} - ${message}`);

  while (state.managerFeed.length > 9) {
    state.managerFeed.pop();
  }

  managerFeed.replaceChildren();
  state.managerFeed.forEach((itemText) => {
    const item = document.createElement("li");
    item.textContent = itemText;
    managerFeed.append(item);
  });
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
    return;
  }

  imageResult.removeAttribute("src");
  imageResult.alt = "";
  imageResult.hidden = true;
  imageResultFallback.hidden = false;
}

function marketingPlan(review) {
  return review.designPlan?.marketingPlan || [
    `Lead with ${review.category || "the trend"} buyers and validate copy against current demand.`,
    "Launch one hero design first, then expand to secondary products if the signal holds.",
    "Use marketplace tags and source links to write product titles without copying protected terms.",
  ];
}

function renderAgentReports(review, entry) {
  const demandLine = review.popularityReasons?.[0] || review.signals?.[0] || "Demand signal is still forming.";
  const marketLine = `Market: ${review.market || entry.market || "US"} via ${sourceLabel(entry.source)}. ${review.evidence || "Trend source is active."}`;
  const salesLine = review.salesSignal?.summary || "Sales proxy is waiting for Etsy configuration.";
  const designLine = review.designPlan?.direction || review.graphicElements?.[0] || "Design direction is still forming.";
  const marketingLine = marketingPlan(review)[0];
  const riskLine = review.watchouts?.[0] || "No major watchout detected, but review saturation and IP before launch.";

  demandRoomStatus.textContent = shortText(review.category, "Demand signal", 36);
  marketRoomStatus.textContent = `${review.market || entry.market || "US"} market`;
  salesRoomStatus.textContent =
    review.salesSignal?.status === "active"
      ? `${review.salesSignal.topListings?.length || 0} Etsy proxies`
      : "Needs Etsy key";
  designRoomStatus.textContent = review.designPlan?.proofLevel || `${review.graphicElements?.length || 0} visual cues`;
  marketingRoomStatus.textContent = `${marketingPlan(review).length} launch actions`;
  riskRoomStatus.textContent = `${review.watchouts?.length || 0} watchouts`;

  demandReport.textContent = demandLine;
  marketReport.textContent = marketLine;
  salesReport.textContent = salesLine;
  designReport.textContent = designLine;
  marketingReport.textContent = marketingLine;
  riskReport.textContent = riskLine;
}

function renderManagerDecision(review, entry) {
  const fruitScore = getFruitScore(review);
  const fruitTier = getFruitTier(fruitScore);
  const product = review.product || "merch design";
  const category = review.category || entry.query || "trend";
  const market = review.market || entry.market || "US";

  officeScene.dataset.runState = fruitTier;
  boardScore.textContent = `${fruitScore}`;
  managerDirective.textContent = `${fruitScore}/100: ${shortText(product, "merch project", 46)}`;
  managerReason.textContent =
    fruitTier === "high"
      ? `Proceed: agents found a strong ${category} opportunity for ${market}.`
      : fruitTier === "medium"
        ? `Test carefully: ${category} has useful signal, but sales proof or risk checks need more confidence.`
        : `Hold for scouting: ${category} needs stronger proof before production.`;

  addManagerFeed(`${fruitTier.toUpperCase()} priority on ${product}: ${managerReason.textContent}`);
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
  boardTitle.textContent = review.title;
  listingLink.href = review.url || "#";
  listingPrice.textContent = review.product || "Merch design";
  boardCategory.textContent = review.category || entry.query || "Trend";
  sourceMode.textContent = sourceLabel(entry.source);
  marketText.textContent = review.market || entry.market || "US";
  summaryText.textContent = review.designerBrief || review.summary;
  reviewCount.textContent = state.reviewed;
  renderImageResult(review);
  renderAgentReports(review, entry);
  renderManagerDecision(review, entry);

  setList(reasonList, review.popularityReasons || review.signals, "No popularity reasoning found in the trend metadata.");
  setList(elementList, review.graphicElements, "No graphical elements were inferred yet.");
  setList(marketingPlanList, marketingPlan(review), "No marketing plan generated yet.");
  setList(designPlanList, review.designPlan?.rollout, "No production rollout generated yet.");
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
    meta.textContent = `${getFruitScore(review)}/100 - ${review.product || "merch"} - ${formatClock(new Date(entry.createdAt))}`;

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

    item.dataset.status = source.status;
    name.textContent = source.name;
    meta.textContent = `${source.statusLabel} - ${source.signal}`;
    item.append(name, meta);
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

async function runAgentPhase(agentKey, reportText, duration = 450) {
  const agent = agents[agentKey];
  setAgentStatus(agentKey, "working", agent?.active || "Working");
  agentTask.textContent = agent?.active || "Agent working";
  addManagerFeed(`${agent?.label || agentKey} started.`);
  await sleep(duration);

  if (reportText) {
    addManagerFeed(`${agent?.label || agentKey} reported: ${shortText(reportText, "complete", 88)}`);
  }

  setAgentStatus(agentKey, "done");
}

async function runReview(trigger) {
  if (state.loading) {
    return;
  }

  state.loading = true;
  clearMissionTimers();
  reviewNowButton.disabled = true;
  officeScene.dataset.runState = "running";
  setAllAgents("queued");
  setStatus(trigger === "manual" ? "Manual cycle" : "Autonomous cycle", "loading");
  addManagerFeed(trigger === "manual" ? "Manual full agent cycle started." : "Scheduled autonomous cycle started.");

  try {
    await runAgentPhase("manager", "Assigned research, sales, design, marketing, and risk tasks.", 350);
    setAgentStatus("demand", "working", agents.demand.active);
    setAgentStatus("market", "working", agents.market.active);
    setAgentStatus("sales", "working", agents.sales.active);
    agentTask.textContent = "Research agents collecting signals";
    const payload = await fetchReview(trigger);

    const review = payload.review;
    await sleep(550);
    await runAgentPhase("demand", review.popularityReasons?.[0] || review.signals?.[0], 300);
    await runAgentPhase("market", `${review.market || payload.market || "US"} market context collected.`, 300);
    await runAgentPhase("sales", review.salesSignal?.summary, 300);
    await runAgentPhase("design", review.designPlan?.direction || review.graphicElements?.[0], 420);
    await runAgentPhase("marketing", marketingPlan(review)[0], 420);
    await runAgentPhase("risk", review.watchouts?.[0], 360);

    setAgentStatus("manager", "working", agents.manager.active);
    agentTask.textContent = "Manager synthesizing reports";
    await sleep(400);
    renderReview(payload);
    await sleep(350);
    setAgentStatus("manager", "done", "Decision posted");
    agentTask.textContent = "Agents monitoring next opportunity";
    setStatus(sourceLabel(payload.source), payload.source);
  } catch (error) {
    officeScene.dataset.runState = "error";
    setAllAgents("idle");
    setStatus("Cycle failed", "error");
    agentTask.textContent = "Autonomous cycle failed";
    summaryText.textContent = explainFetchError(error);
    addManagerFeed(`Cycle failed: ${error.message}`);
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
  setStatus("Archive view", "ready");
  agentTask.textContent = "Reviewing archived cycle";
  addManagerFeed(`Archive opened: ${entry.review.title}`);
});

state.countdownTimerId = window.setInterval(renderCountdown, 1000);
setAllAgents("idle");
renderCountdown();
loadApiSources();
runReview("initial");
