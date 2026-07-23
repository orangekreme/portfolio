const functions = require("firebase-functions");
const { Client } = require("@notionhq/client");

// Initialize Notion client using Firebase config secret
// Set with: firebase functions:config:set notion.token="your_token"
//           notion.posts_db="your_posts_db_id"
//           notion.countries_db="your_countries_db_id"
function getNotion() {
  return new Client({ auth: functions.config().notion.token });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function richTextToString(richText) {
  if (!richText || !richText.length) return "";
  return richText.map((t) => t.plain_text).join("");
}

// ─── /api/thoughts ─────────────────────────────────────────────────────────────
// Returns published blog posts sorted newest first.
// Notion database must have these properties:
//   Title (title)          – post title
//   Slug (rich_text)       – URL slug, e.g. "on-data-storytelling"
//   Date (date)            – publish date
//   Tag (select)           – e.g. Data, Finance, Running, Travel, Life, Tech
//   Excerpt (rich_text)    – one-sentence teaser
//   Published (checkbox)   – only published:true rows are returned

exports.thoughts = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const notion = getNotion();
    const dbId = functions.config().notion.posts_db;

    const response = await notion.databases.query({
      database_id: dbId,
      filter: { property: "Published", checkbox: { equals: true } },
      sorts: [{ property: "Date", direction: "descending" }],
    });

    const posts = response.results.map((page) => {
      const props = page.properties;
      const dateStr = props.Date?.date?.start ?? null;
      const monthYear = dateStr
        ? new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          })
        : "";

      return {
        id: page.id,
        title: richTextToString(props.Title?.title),
        slug: richTextToString(props.Slug?.rich_text),
        date: dateStr,
        monthYear,
        tag: props.Tag?.select?.name ?? "",
        excerpt: richTextToString(props.Excerpt?.rich_text),
      };
    });

    res.json({ posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load posts." });
  }
});

// ─── /api/thoughts/:slug ────────────────────────────────────────────────────────
// Returns the full content of one post as a list of blocks.
// The client renders them into HTML.

exports.thoughtContent = functions.https.onRequest(async (req, res) => {
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
    const notion = getNotion();
    const dbId = functions.config().notion.posts_db;

    // Find the page by slug
    const queryRes = await notion.databases.query({
      database_id: dbId,
      filter: {
        and: [
          { property: "Published", checkbox: { equals: true } },
          { property: "Slug", rich_text: { equals: slug } },
        ],
      },
    });

    if (!queryRes.results.length) {
      res.status(404).json({ error: "Post not found." });
      return;
    }

    const page = queryRes.results[0];
    const props = page.properties;
    const dateStr = props.Date?.date?.start ?? null;
    const monthYear = dateStr
      ? new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })
      : "";

    // Fetch page blocks (content)
    const blocksRes = await notion.blocks.children.list({
      block_id: page.id,
    });

    // Convert blocks to a simple HTML-friendly format
    const blocks = blocksRes.results.map((block) => {
      const type = block.type;
      const content = block[type];
      const text = content?.rich_text
        ? content.rich_text
            .map((t) => {
              let s = t.plain_text;
              if (t.annotations?.bold) s = `<strong>${s}</strong>`;
              if (t.annotations?.italic) s = `<em>${s}</em>`;
              if (t.href) s = `<a href="${t.href}">${s}</a>`;
              return s;
            })
            .join("")
        : "";

      return { type, text };
    });

    res.json({
      title: richTextToString(props.Title?.title),
      monthYear,
      tag: props.Tag?.select?.name ?? "",
      blocks,
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
//   Code (rich_text)       – ISO 3166-1 alpha-2, e.g. "FR"
//   Flag (rich_text)       – emoji flag, e.g. "🇫🇷"
//   Note (rich_text)       – short note shown on map click

exports.countries = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  try {
    const notion = getNotion();
    const dbId = functions.config().notion.countries_db;

    const response = await notion.databases.query({
      database_id: dbId,
      sorts: [{ property: "Name", direction: "ascending" }],
    });

    // Build visited object: { "FR": { name, flag, note }, ... }
    const visited = {};
    const visitedCodes = [];
    const visitedNames = [];

    for (const page of response.results) {
      const props = page.properties;
      const code = richTextToString(props.Code?.rich_text).trim().toUpperCase();
      const name = richTextToString(props.Name?.title).trim();
      const flag = richTextToString(props.Flag?.rich_text).trim();
      const note = richTextToString(props.Note?.rich_text).trim();

      if (code && name) {
        visited[code] = { name, flag, note };
        visitedCodes.push(code);
        visitedNames.push(name);
      }
    }

    res.json({ visited, visitedCodes, visitedNames });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load countries." });
  }
});
