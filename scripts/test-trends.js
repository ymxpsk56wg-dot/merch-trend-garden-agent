const url = new URL("https://trends.google.com/trending/rss");
url.searchParams.set("geo", process.env.TREND_GEO || "US");

fetch(url, {
  headers: {
    Accept: "application/rss+xml, application/xml, text/xml",
    "User-Agent": "MerchTrendReviewAgent/1.0",
  },
})
  .then(async (response) => {
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Trend RSS returned HTTP ${response.status}`);
    }

    const titles = [...text.matchAll(/<title>([\s\S]*?)<\/title>/g)]
      .slice(1, 4)
      .map((match) => decodeXml(match[1].trim()));

    console.log(
      JSON.stringify(
        {
          ok: true,
          api: "Google Trends RSS",
          sampleTitles: titles,
        },
        null,
        2,
      ),
    );
  })
  .catch((error) => {
    console.error(`Trend API test failed: ${error.message}`);
    process.exit(1);
  });

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
