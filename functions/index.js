// NOTE: @notionhq/client is pinned to v2 in package.json — v5 removed
// databases.query(), which every endpoint below relies on. Do not bump to v5
// without migrating to dataSources.query({ data_source_id }).
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { Client } = require("@notionhq/client");

const NOTION_TOKEN = defineSecret("NOTION_TOKEN");
const NOTION_POSTS_DB = defineSecret("NOTION_POSTS_DB");
const NOTION_COUNTRIES_DB = defineSecret("NOTION_COUNTRIES_DB");
const NOTION_RACES_DB = defineSecret("NOTION_RACES_DB");
const NOTION_POSTCARDS_DB = defineSecret("NOTION_POSTCARDS_DB");
const NOTION_POLAROIDS_DB = defineSecret("NOTION_POLAROIDS_DB");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function richTextToString(richText) {
  if (!richText || !richText.length) return "";
  return richText.map((t) => t.plain_text).join("");
}

// ─── Substack API helper ──────────────────────────────────────────────────────
// Fetches ALL posts via the Substack JSON API (paginated).
// The RSS feed only returns the most recent ~20 posts, so we use the API instead.

function httpsGet(url) {
  const https = require("https");
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let data = "";
      r.on("data", chunk => { data += chunk; });
      r.on("end", () => resolve(data));
      r.on("error", reject);
    }).on("error", reject);
  });
}

// Convert imgur page URLs to direct image URLs, e.g.
// https://imgur.com/AbCdEfG → https://i.imgur.com/AbCdEfG.jpg
// Other hosts (Google Photos direct links, etc.) pass through unchanged.
function toDirectImage(url) {
  if (!url) return null;
  const m = url.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)\/?$/);
  if (m) return `https://i.imgur.com/${m[1]}.jpg`;
  return url;
}

// Format an ISO date string (YYYY-MM-DD) as MM/DD/YYYY for display.
function displayDateFromISO(dateStr) {
  if (!dateStr) return null;
  const dt = new Date(dateStr + "T00:00:00");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function formatDate(isoString) {
  if (!isoString) return { monthYear: "", displayDate: "", dateStr: null };
  const dateObj = new Date(isoString);
  const monthYear = dateObj.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const yyyy = dateObj.getFullYear();
  return { monthYear, displayDate: `${mm}/${dd}/${yyyy}`, dateStr: dateObj.toISOString().slice(0, 10) };
}

async function fetchSubstackPosts() {
  // Substack's /api/v1/posts now returns { posts: [...] } and REJECTS the `offset`
  // query param ("Invalid value"), so the old offset-pagination loop broke and
  // returned nothing. We request a single page with a high (but under-cap) limit;
  // `limit=50` returns the whole archive today. Revisit if posts exceed ~40.
  const posts = [];
  const raw = await httpsGet(
    `https://orangekreme.substack.com/api/v1/posts?limit=50`
  );
  const parsed = JSON.parse(raw);
  const page = Array.isArray(parsed) ? parsed : (parsed.posts || []);

  for (const p of page) {
    const title = (p.title || "").trim();
    const slug  = (p.slug  || "").trim();
    if (!title || !slug) continue;

    const { monthYear, displayDate, dateStr } = formatDate(p.post_date);
    const guid    = p.canonical_url || `https://orangekreme.substack.com/p/${slug}`;
    const excerpt = (p.subtitle || p.description || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const body    = p.body_html || "";   // present on list endpoint for public posts

    posts.push({ title, slug, guid, dateStr, monthYear, displayDate, excerpt, body });
  }

  return posts;
}

// Fetch full HTML body for a single post via the Substack API post detail endpoint.
async function fetchSubstackPostBody(slug) {
  const raw = await httpsGet(`https://orangekreme.substack.com/api/v1/posts/${slug}`);
  const p = JSON.parse(raw);
  return (p.body_html || "")
    .replace(/<div[^>]*class="[^"]*subscription-widget[^"]*"[^>]*>[\s\S]*?<\/div>/g, "")
    .trim();
}

// ─── /api/thoughts ─────────────────────────────────────────────────────────────
// Returns post list (no body) from Substack RSS.

exports.thoughts = onRequest({}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const all = await fetchSubstackPosts();
    const posts = all.map(({ body, ...rest }) => rest); // strip body from list
    res.json({ posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load posts." });
  }
});

// ─── /api/thoughts/content ─────────────────────────────────────────────────────
// Returns full post content from Substack RSS by slug.

exports.thoughtContent = onRequest({}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  const slug = req.query.slug;
  if (!slug) {
    res.status(400).json({ error: "Missing ?slug= parameter." });
    return;
  }

  try {
    // Fetch list entry (title, date, excerpt) and full body in parallel
    const [all, body] = await Promise.all([
      fetchSubstackPosts(),
      fetchSubstackPostBody(slug),
    ]);
    const post = all.find(p => p.slug === slug);

    if (!post) {
      res.status(404).json({ error: "Post not found." });
      return;
    }

    res.json({
      title: post.title,
      displayDate: post.displayDate,
      monthYear: post.monthYear,
      excerpt: post.excerpt,
      body: body || post.body,
      substackUrl: post.guid,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load post content." });
  }
});

// ─── /api/countries ────────────────────────────────────────────────────────────
// Returns visited countries.
// Notion database must have these properties:
//   Name (title)           – country name, e.g. "France"
//   Code (rich_text)       – ISO 3166-1 alpha-3, e.g. "USA"
//   Flag (rich_text)       – emoji flag, e.g. "🇺🇸"
//   Note (rich_text)       – short note shown on map click
//   Enter (date)           – arrival date
//   Exit (date)            – departure date
// Each row is a trip — the same country can appear multiple times.

exports.countries = onRequest({ secrets: [NOTION_TOKEN, NOTION_COUNTRIES_DB] }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const notion = new Client({ auth: NOTION_TOKEN.value() });
    const dbId = NOTION_COUNTRIES_DB.value();

    const response = await notion.databases.query({
      database_id: dbId,
      sorts: [{ property: "Enter", direction: "ascending" }],
    });

    // visited: deduplicated map for the SVG map highlights
    const visited = {};
    // trips: every row in order, for the timeline list
    const trips = [];

    for (const page of response.results) {
      const props = page.properties;
      const code = richTextToString(props.Code?.rich_text).trim().toUpperCase();
      const name = richTextToString(props.Name?.title).trim();
      const flag = richTextToString(props.Flag?.rich_text).trim();
      const note = richTextToString(props.Note?.rich_text).trim();
      const region = richTextToString(props.Region?.rich_text).trim(); // e.g. "California" for USA rows
      const city = richTextToString(props.City?.rich_text).trim(); // e.g. "San Francisco" for USA rows
      const enterDate = props.Enter?.date?.start ?? null;
      const exitDate = props.Exit?.date?.start ?? null;

      if (!code || !name) continue;

      // Deduplicated map for SVG highlighting
      if (!visited[code]) {
        visited[code] = { name, flag, note };
      }

      // Format dates for display: "MM/DD"
      function fmt(d) {
        if (!d) return null;
        const dt = new Date(d + "T00:00:00");
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${mm}/${dd}`;
      }

      trips.push({ code, name, flag, note, region, city, enterDate, exitDate, enterFmt: fmt(enterDate), exitFmt: fmt(exitDate) });
    }

    // Sort: dated trips ascending, undated trips go to the bottom
    trips.sort((a, b) => {
      if (!a.enterDate && !b.enterDate) return 0;
      if (!a.enterDate) return 1;
      if (!b.enterDate) return -1;
      return a.enterDate.localeCompare(b.enterDate);
    });

    const visitedCodes = [...new Set(trips.map(t => t.code))];
    const visitedNames = [...new Set(trips.map(t => t.name))];

    res.json({ visited, visitedCodes, visitedNames, trips });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load countries." });
  }
});

// ─── /api/races ─────────────────────────────────────────────────────────────
// Returns race entries sorted by date descending.
// Notion database must have these properties:
//   Name (title)           – race name, e.g. "Boston Marathon"
//   Distance (select)      – e.g. "Marathon", "Half Marathon", "10K", "5K"
//   Date (date)            – race date
//   Time (rich_text)       – official finish time, e.g. "3:42:15"
//   BibImage (url)         – Google Photos or direct image URL for the bib
//   Strava (url)           – link to Strava activity

exports.races = onRequest({ secrets: [NOTION_TOKEN, NOTION_RACES_DB] }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const notion = new Client({ auth: NOTION_TOKEN.value() });
    const dbId = NOTION_RACES_DB.value();

    const response = await notion.databases.query({
      database_id: dbId,
      sorts: [{ property: "Date", direction: "descending" }],
    });

    const races = response.results.map((page) => {
      const props = page.properties;
      const dateStr = props.Date?.date?.start ?? null;

      const displayDate = dateStr
        ? (() => {
            const dt = new Date(dateStr + "T00:00:00");
            const mm = String(dt.getMonth() + 1).padStart(2, "0");
            const dd = String(dt.getDate()).padStart(2, "0");
            const yyyy = dt.getFullYear();
            return `${mm}/${dd}/${yyyy}`;
          })()
        : null;

      // Convert imgur page URLs to direct image URLs
      // https://imgur.com/AbCdEfG → https://i.imgur.com/AbCdEfG.jpg
      function toDirectImage(url) {
        if (!url) return null;
        const m = url.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)\/?$/);
        if (m) return `https://i.imgur.com/${m[1]}.jpg`;
        return url;
      }

      return {
        name: richTextToString(props.Name?.title).trim(),
        distance: props.Distance?.select?.name ?? "",
        date: dateStr,
        displayDate,
        time: richTextToString(props.Time?.rich_text).trim(),
        bibImage: toDirectImage(props.Bibimage?.url ?? null),
        strava: props.Strava?.url ?? null,
        mapImage: toDirectImage(props.MapImage?.url ?? null),
        notes: richTextToString(props.Notes?.rich_text).trim(),
      };
    });

    res.json({ races });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load races." });
  }
});

// ─── /api/films ──────────────────────────────────────────────────────────────
// Fetches recent diary entries from the Letterboxd RSS feed for orangekreme.
// Returns film title, rating (stars), date watched, poster image, and link.

exports.films = onRequest({}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const https = require("https");

    // Fetch the RSS feed
    const xml = await new Promise((resolve, reject) => {
      https.get("https://letterboxd.com/orangekreme/rss/", (r) => {
        let data = "";
        r.on("data", chunk => { data += chunk; });
        r.on("end", () => resolve(data));
        r.on("error", reject);
      }).on("error", reject);
    });

    // Parse items from XML using regex (no external parser needed)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];

      const get = (tag) => {
        const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`));
        return m ? (m[1] || m[2] || "").trim() : "";
      };

      const title = get("title");
      const link = get("link") || item.match(/<link>(.*?)<\/link>/)?.[1] || "";
      const pubDate = get("pubDate");
      const description = get("description");

      // Rating: Letterboxd uses letterboxd:memberRating or stars in title
      const ratingMatch = item.match(/<letterboxd:memberRating>([\d.]+)<\/letterboxd:memberRating>/);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

      // Film title and year from letterboxd:filmTitle / letterboxd:filmYear
      const filmTitleMatch = item.match(/<letterboxd:filmTitle>(.*?)<\/letterboxd:filmTitle>/);
      const filmYearMatch = item.match(/<letterboxd:filmYear>(.*?)<\/letterboxd:filmYear>/);
      const filmTitle = filmTitleMatch ? filmTitleMatch[1].trim() : title.replace(/, \d{4}$/, "").replace(/ - \d+ star[s]?$/, "").trim();
      const filmYear = filmYearMatch ? filmYearMatch[1].trim() : "";

      // Watch date from letterboxd:watchedDate
      const watchedMatch = item.match(/<letterboxd:watchedDate>(.*?)<\/letterboxd:watchedDate>/);
      const watchedDate = watchedMatch ? watchedMatch[1].trim() : null;
      const displayDate = watchedDate
        ? (() => {
            const dt = new Date(watchedDate + "T00:00:00");
            const mm = String(dt.getMonth() + 1).padStart(2, "0");
            const dd = String(dt.getDate()).padStart(2, "0");
            const yyyy = dt.getFullYear();
            return `${mm}/${dd}/${yyyy}`;
          })()
        : null;

      // Poster image from description img tag
      const imgMatch = description.match(/<img[^>]+src="([^"]+)"/);
      const poster = imgMatch ? imgMatch[1] : null;

      // Stars string e.g. "★★★½"
      const starsStr = rating !== null
        ? "★".repeat(Math.floor(rating)) + (rating % 1 >= 0.5 ? "½" : "")
        : "";

      items.push({ filmTitle, filmYear, rating, starsStr, watchedDate, displayDate, poster, link });
    }

    res.json({ films: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load films." });
  }
});

// ─── /api/postcards ────────────────────────────────────────────────────────────
// Returns postcards sorted by Order ascending (then by Date).
// Notion database must have these properties:
//   Name (title)        – short label, e.g. "Paris from Mom"
//   Type (select)       – "Received", "Sent", or "Collected"
//   FrontImage (url)    – hosted image URL of the postcard front
//   BackImage (url)     – hosted image URL of the postcard back (optional for Collected)
//   Location (rich_text)– place the postcard is from, e.g. "Paris, France"
//   Date (date)         – date sent / received / collected
//   From (rich_text)    – sender (omit for Collected)
//   To (rich_text)      – recipient (omit for Collected)
//   Order (number)      – manual sort key (optional)

exports.postcards = onRequest({ secrets: [NOTION_TOKEN, NOTION_POSTCARDS_DB] }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const notion = new Client({ auth: NOTION_TOKEN.value() });
    const dbId = NOTION_POSTCARDS_DB.value();

    const response = await notion.databases.query({
      database_id: dbId,
      sorts: [
        { property: "Order", direction: "ascending" },
        { property: "Date", direction: "ascending" },
      ],
    });

    // PUBLIC response: fronts + non-sensitive metadata only. The back image and
    // the From/To names live on the postcard back (which shows Victoria's mailing
    // address) and are NEVER sent here — they come only from /api/postcard-backs
    // after the passcode is verified server-side. We expose just a `hasBack` flag.
    const postcards = response.results.map((page) => {
      const props = page.properties;
      const dateStr = props.Date?.date?.start ?? null;
      return {
        id: page.id,
        name: richTextToString(props.Name?.title).trim(),
        type: props.Type?.select?.name ?? "",
        frontImage: toDirectImage(props.FrontImage?.url ?? null),
        location: richTextToString(props.Location?.rich_text).trim(),
        date: dateStr,
        displayDate: displayDateFromISO(dateStr),
        hasBack: !!toDirectImage(props.BackImage?.url ?? null),
      };
    }).filter((p) => p.frontImage || p.hasBack); // keep cards with a front OR a (gated) back

    res.json({ postcards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load postcards." });
  }
});

// ─── /api/postcard-backs (passcode-gated) ───────────────────────────────────────
// POST { password } — passcode checked SERVER-SIDE. Only on a correct passcode do
// we return the back images + From/To for each postcard that has a back. This is
// what keeps the backs (and Victoria's mailing address on them) private: a visitor
// without the passcode never receives the back image URLs at all.
const POSTCARD_BACKS_PASSWORD = "iambigtoe"; // EDIT ME — the passcode you share with trusted people.

exports.postcardBacks = onRequest({ secrets: [NOTION_TOKEN, NOTION_POSTCARDS_DB] }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }

  const pass = ((req.body || {}).password || "").toString();
  if (pass !== POSTCARD_BACKS_PASSWORD) {
    res.status(401).json({ ok: false, error: "Wrong passcode." });
    return;
  }

  try {
    const notion = new Client({ auth: NOTION_TOKEN.value() });
    const dbId = NOTION_POSTCARDS_DB.value();
    const response = await notion.databases.query({ database_id: dbId });

    const backs = response.results.map((page) => {
      const props = page.properties;
      const backImage = toDirectImage(props.BackImage?.url ?? null);
      if (!backImage) return null;
      return {
        id: page.id,
        backImage,
        from: richTextToString(props.From?.rich_text).trim(),
        to: richTextToString(props.To?.rich_text).trim(),
      };
    }).filter(Boolean);

    res.json({ ok: true, backs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load postcard backs." });
  }
});

// ─── /api/polaroids ────────────────────────────────────────────────────────────
// Returns polaroid photos sorted by Order ascending (then by Date).
// Notion database must have these properties:
//   Name (title)        – short label / alt text
//   Image (url)         – hosted image URL of the photo
//   Date (date)         – date the photo was taken (optional)
//   Location (rich_text)– where it was taken (optional)
//   Order (number)      – manual sort key (optional)

exports.polaroids = onRequest({ secrets: [NOTION_TOKEN, NOTION_POLAROIDS_DB] }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const notion = new Client({ auth: NOTION_TOKEN.value() });
    const dbId = NOTION_POLAROIDS_DB.value();

    const response = await notion.databases.query({
      database_id: dbId,
      sorts: [
        { property: "Order", direction: "ascending" },
        { property: "Date", direction: "ascending" },
      ],
    });

    const polaroids = response.results.map((page) => {
      const props = page.properties;
      const dateStr = props.Date?.date?.start ?? null;
      return {
        id: page.id,
        name: richTextToString(props.Name?.title).trim(),
        image: toDirectImage(props.Image?.url ?? null),
        date: dateStr,
        displayDate: displayDateFromISO(dateStr),
        location: richTextToString(props.Location?.rich_text).trim(),
      };
    }).filter((p) => p.image); // skip rows without an image

    res.json({ polaroids });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load polaroids." });
  }
});

// ─── Currently (editable "what I'm up to" status) ───────────────────────────────
// GET  → the saved status values (or {} if none yet; the page uses its defaults).
// POST → { password, data? } — the passcode is checked SERVER-SIDE here, so it is
//        never exposed to the browser and the client "edit mode" can't be bypassed
//        to write. With `data`, it saves; without, it just verifies the password.
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

// EDIT ME — the editor passcode. Checked here on the server; change it anytime.
const CURRENTLY_PASSWORD = "iambigtoe";

exports.currently = onRequest({}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const ref = admin.firestore().collection("site").doc("currently");

  if (req.method === "GET") {
    try {
      const snap = await ref.get();
      res.json(snap.exists ? (snap.data() || {}) : {});
    } catch (e) {
      res.json({}); // Firestore unreachable → page falls back to its defaults
    }
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const pass = (body.password || "").toString();
    if (pass !== CURRENTLY_PASSWORD) {
      res.status(401).json({ ok: false, error: "Wrong password." });
      return;
    }
    try {
      if (body.data && typeof body.data === "object") {
        const clean = {};
        for (const k of Object.keys(body.data)) {
          if (typeof body.data[k] === "string") clean[k] = body.data[k].slice(0, 400);
        }
        await ref.set(clean, { merge: true });
        res.json({ ok: true, saved: true });
      } else {
        res.json({ ok: true }); // verify only
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: "Could not save.", detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed." });
});

// ─── /api/polaroid-board (saved arrangement of the polaroid corkboard) ──────────
// GET  → { items: { <polaroidId>: {onBoard,x,y,angle,z} }, stackOrder: [...] } or {}.
// POST → { password, board? } — passcode checked SERVER-SIDE (never exposed to the
//        browser). With `board`, it saves the arrangement everyone sees; without, it
//        just verifies the passcode (used to enter the on-page "curate" edit mode).
// Positions are stored in Firestore (not Notion), mirroring the `currently` pattern.
const POLAROID_BOARD_PASSWORD = "iambigtoe"; // EDIT ME — the curator passcode.

exports.polaroidBoard = onRequest({}, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const ref = admin.firestore().collection("site").doc("polaroidBoard");

  if (req.method === "GET") {
    try {
      const snap = await ref.get();
      res.json(snap.exists ? (snap.data() || {}) : {});
    } catch (e) {
      res.json({}); // Firestore unreachable → page falls back to its default layout
    }
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const pass = (body.password || "").toString();
    if (pass !== POLAROID_BOARD_PASSWORD) {
      res.status(401).json({ ok: false, error: "Wrong password." });
      return;
    }
    try {
      if (body.board && typeof body.board === "object") {
        // Sanitise: keep only known numeric/boolean position fields per item.
        const rawItems = (body.board.items && typeof body.board.items === "object") ? body.board.items : {};
        const items = {};
        for (const id of Object.keys(rawItems).slice(0, 500)) {
          const it = rawItems[id] || {};
          items[id] = {
            onBoard: !!it.onBoard,
            x: Number(it.x) || 0,
            y: Number(it.y) || 0,
            angle: Number(it.angle) || 0,
            z: Number(it.z) || 0,
          };
        }
        const stackOrder = Array.isArray(body.board.stackOrder)
          ? body.board.stackOrder.filter((s) => typeof s === "string").slice(0, 500)
          : [];
        await ref.set({ items, stackOrder }, { merge: false });
        res.json({ ok: true, saved: true });
      } else {
        res.json({ ok: true }); // verify only
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: "Could not save.", detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed." });
});
