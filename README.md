# Merch Trend Garden Agent

An online-ready Node app with a pixel-art garden workplace. The agent reviews one popular trend/design opportunity every 10 minutes, walks it to the board, and posts it to the sidebar. A manual **Review now** button runs the same flow immediately.

The live source uses Google Trends RSS, so no paid API key is required. It rotates through:

- T-shirts and graphic tees
- Cups, mugs, tumblers, and drinkware
- Stickers, totes, posters, phone cases, and related merch

## Run locally

```bash
npm run dev
```

Open `http://localhost:4173`.

## API setup

No API key is needed for the active Google Trends source.

```bash
npm run test:api
```

Core environment variables:

```bash
export TREND_LIMIT="12"
export TREND_GEO="US"
```

Additional easy setup access points are listed by the app at `/api/sources`:

- Google Trends RSS: live now, no key, realtime demand by country.
- eBay Browse API: optional free developer account/OAuth token; useful for listings, prices, seller locations, and marketplace-specific demand proxies.
- Etsy Open API: optional free developer app/API key; useful for active listings, tags, shops, and keyword competition. Broad sold-count data is limited.
- YouTube Data API: optional Google Cloud API key; useful for design-content velocity and niche discovery.
- GDELT Doc API: no key, but throttle requests; useful for news/media trend coverage and geography hints.

Optional environment variables:

```bash
export EBAY_ACCESS_TOKEN=""
export EBAY_MARKETPLACE_ID="EBAY_US"
export ETSY_API_KEY=""
export YOUTUBE_API_KEY=""
```

Check the backend directly:

```bash
curl http://localhost:4173/api/health
curl http://localhost:4173/api/sources
curl http://localhost:4173/api/review
```

## Deploy online

Deploy as a Node web service. The repo includes `render.yaml`, so Render can create the service from the Blueprint.

### Render permanent URL

1. Push this folder to a GitHub repo.
2. In Render, choose **New > Blueprint**.
3. Connect the GitHub repo.
4. Render reads `render.yaml` and creates a web service.
5. After deploy, use the permanent `https://<service-name>.onrender.com` URL.

Manual Render settings, if you create a Web Service instead of a Blueprint:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- Environment variables: `TREND_GEO=US`, `TREND_LIMIT=12`

### Custom domain

After the Render service is live, add your domain in Render's Custom Domains panel, then point your DNS records to the values Render provides. Render handles HTTPS certificates.

The browser calls `/api/sources` and `/api/review`; the server calls Google Trends RSS and normalizes the result into a design-opportunity review.

## Temporary public preview

For a quick free public URL from your local machine:

```bash
npm run dev
npm run share
```

The tunnel URL stays live only while your computer, the Node server, and the tunnel process are running.
