# Victoria Deng — Portfolio

Personal portfolio site. Built with vanilla HTML, CSS, and JavaScript. Hosted on Firebase. Blog posts and visited countries are managed from Notion.

---

## Site structure

```
public/
├── index.html          # Home (TOC nav)
├── about.html          # About — experience, education, skills, contact
├── work.html           # Work — project cards
├── thoughts.html       # Thoughts — blog post index (fetches from Notion)
├── post.html           # Dynamic post renderer (reads ?slug= from URL)
├── travel.html         # Travel — interactive world map (fetches from Notion)
├── styles.css          # All styles
└── posts/
    ├── post-template.html          # Legacy template (now unused)
    └── on-data-storytelling.html   # Static example post (legacy)

functions/
├── index.js            # Firebase Functions — /api/thoughts, /api/countries
└── package.json
```

---

## Notion CMS setup

The site pulls content from two Notion databases via Firebase Functions.

### Step 1 — Create a Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration**
3. Name it `Portfolio` and choose your workspace
4. Copy the **Internal Integration Token** — you'll need it below

### Step 2 — Create the Posts database

Create a Notion database called **Thoughts** (or any name) with these properties:

| Property   | Type       | Notes                                      |
|------------|------------|--------------------------------------------|
| Title      | Title      | Post title                                 |
| Slug       | Text       | URL-safe slug, e.g. `on-data-storytelling` |
| Date       | Date       | Publish date                               |
| Tag        | Select     | Options: Data, Finance, Running, Travel, Life, Tech |
| Excerpt    | Text       | One-sentence teaser shown on the index     |
| Published  | Checkbox   | Only checked rows appear on the site       |

Then:
- Click **Share** → **Add connections** → select your `Portfolio` integration
- Copy the database ID from the URL: `notion.so/YOUR_WORKSPACE/**{DATABASE_ID}**?v=...`

### Step 3 — Create the Countries database

Create a Notion database called **Countries** with these properties:

| Property | Type  | Notes                              |
|----------|-------|------------------------------------|
| Name     | Title | Country name, e.g. `France`        |
| Code     | Text  | ISO 3166-1 alpha-2, e.g. `FR`      |
| Flag     | Text  | Emoji flag, e.g. `🇫🇷`            |
| Note     | Text  | Short note shown on map click      |

Then share this database with the `Portfolio` integration too.

### Step 4 — Set Firebase config secrets

```bash
firebase functions:config:set \
  notion.token="your_integration_token" \
  notion.posts_db="your_posts_database_id" \
  notion.countries_db="your_countries_database_id"
```

### Step 5 — Deploy

```bash
firebase deploy
```

That's it. The site will now fetch posts and countries from Notion on every page load.

---

## How to add a blog post

1. Open your **Thoughts** Notion database
2. Add a new row
3. Fill in: Title, Slug (no spaces, use hyphens), Date, Tag, Excerpt
4. Write the post content directly in the Notion page body
5. Check **Published** when it's ready to go live

No code changes needed.

---

## How to add a visited country

1. Open your **Countries** Notion database
2. Add a new row
3. Fill in: Name (full English name), Code (ISO 3166-1 alpha-2), Flag (emoji), Note

ISO code reference: US, CN, GB, FR, DE, JP, AU, BR, IN, ES, PT, NL, KR, SG, NZ, MX, CA, IT, TH
Full list: [Wikipedia ISO 3166-1](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)

No code changes needed.

---

## How to add a work project

Open `public/work.html` and copy this block inside `.project-list`:

```html
<a href="https://your-project-url.com" class="project-card" target="_blank">
  <div class="project-image">
    <img src="path/to/screenshot.png" alt="Project name" />
  </div>
  <div class="project-meta">
    <span class="project-name">Project Name</span>
    <div class="project-right">
      <span class="project-tag">Data Visualization</span>
      <span class="project-link">github.com ↗</span>
    </div>
  </div>
</a>
```

Project images go in `public/` (or a subfolder). Recommended size: **1280×720px** or any 16:9 ratio.

---

## Local development

```bash
# Start a local server
cd public && python3 -m http.server 8765
```

Note: The `/api/*` routes only work when deployed to Firebase (they call Firebase Functions). Locally, the pages will show a loading/error state for dynamic content.

---

## Deploying

```bash
firebase deploy
```

Make sure you're logged in (`firebase login`) and the project is linked (`.firebaserc`).
