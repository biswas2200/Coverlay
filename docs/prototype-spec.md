# Prototype specification: the Resume Builder

!!! danger "This document is mandatory"
    The clickable prototype in `frontend/` is the **source of truth** for what Coverlay does.
    When the full application is built, the **frontend, the backend and the ML service MUST
    implement what is written here and shown in the prototype.** Where this document and the
    prototype disagree, the prototype is right and this document is the bug. Where the
    prototype and the older design documents (SRS, HLD, LLD, wireframes) disagree, the
    prototype wins.

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. A requirement with an ID
(for example `RB-PAGE-07`) can be pointed at in a pull request, a test name or an issue.

## 1. How to use this document

| You are building | Read | You must pass |
|---|---|---|
| The real frontend | sections 3 to 8, then 10 | The prototype's tests (`cd frontend && npm test`) and the walk-through in section 11 |
| The backend | sections 2, 6, 9.1, 10 | The contract tests in section 9.1 |
| The ML service | sections 2, 6.5, 9.2, 10 | The contract tests in section 9.2 |
| Docs, QA, a new teammate | all of it | Nothing: use it as the checklist |

### 1.1 Changing the behaviour

The prototype changes first. A pull request that changes how the Resume Builder behaves
MUST, in the same pull request: change the prototype, change or add the test that pins the
behaviour, and change the requirement here. A pull request to the backend or the ML service that
needs a behaviour the prototype does not show MUST start by adding it to the prototype and to
this document, and get the owner's agreement there. No service may invent behaviour the user
has not seen in the prototype.

### 1.2 Where the prototype lives

| What | File |
|---|---|
| The page | `frontend/src/resume-builder.html`, `frontend/src/js/pages/resume-builder.js` |
| The Community page | `frontend/src/js/pages/community.js`, `community-rules.js` |
| The Applications board and Lay AI's floating chat | `frontend/src/js/pages/applications.js`, `applications-rules.js`, `frontend/src/js/components/lay-chat.js` |
| Rules with no browser in them (data, versions, fit, templates, sample Lay AI replies) | `frontend/src/js/pages/resume-builder-rules.js` |
| Resume to editor document and back, reading order | `frontend/src/js/pages/resume-doc.js` |
| The editor (Tiptap, bundled once into `frontend/src/vendor/tiptap.js`) | `frontend/src/js/pages/resume-editor.js` |
| The rulers | `frontend/src/js/pages/resume-ruler.js` |
| The personal-data guard | `frontend/src/js/pages/privacy-guard-rules.js` |
| The sidebar and the version menu | `frontend/src/js/components/shell.js`, `version-menu.js` |
| Styles | `frontend/src/css/app.css` |
| Tests, which are the executable form of this document | `frontend/tests/resume-builder-rules.test.js`, `resume-doc.test.js`, `resume-ruler.test.js`, `privacy-guard-rules.test.js` |
| Run it | `cd frontend && npm run dev`, then open `/preview` (the React app with sample data) |
| The React app (from 8 Nov 2026) | `frontend/app/`: `pages/` one file per screen, `components/` the shell, Lay AI's chat and the shared pieces, `builder/` the Builder's parts, `lay/` Lay AI's glue, `api/` and `lib/` the backend calls, the session and storage |

**The frontend is a React + TypeScript single-page app built with Vite (FE-04).** The pages of the older static app (`frontend/src/*.html` and
`frontend/src/js/pages/<page>.js`) are kept only until the owner has reviewed the React app; the file names in the table above that end in `-rules.js`,
`resume-doc.js`, `resume-editor.js`, `resume-ruler.js` and `letter-*.js` are shared by both and are the ones that count. A screen is `frontend/app/pages/<Screen>.tsx`
(`Builder.tsx`, `Letters.tsx`, `Applications.tsx`, ...); the older `<name>.html` addresses redirect to its route.

The other prototype pages (Letters, Wallet, Settings, the Lay AI agent) follow the same rule: the prototype is the source of truth for them too.
Their behaviour lives in their `*-rules.js` files and tests. This document specifies the Resume Builder in full because it is the largest piece, the
Applications board in section 6.3, the Community in section 6.4, the Letters in 6.5, the connected apps in 6.6 and the wallet history in 6.8; each of the
others is to get a section here before its backend is built. **Team insights is the exception: it is a mock-up that is not built (RB-PRE-01, section 6.7).**

## 2. The data

### 2.1 The resume (RB-DATA)

A resume is one JSON object. Every version of a resume is a complete copy of it.

```json
{
  "name": "Jane Doe",
  "contact": "jane@email.com | +91 98765 43210 | Bengaluru",
  "summary": "Backend developer with 3 years of <b>Java</b> experience.",
  "experience": [{ "role": "Software Engineer, Acme Corp", "dates": "2021 - now", "details": "Built the payment APIs." }],
  "education": [{ "degree": "B.Tech Computer Science, VIT", "dates": "2021" }],
  "skills": ["Java", "Spring Boot", "SQL"],
  "extra": [{ "title": "Skills by area", "body": [ /* blocks, see 2.2 */ ] }]
}
```

- **RB-DATA-01** The fields above are the whole model. `extra` is optional; when a resume has no
  custom sections the key MUST be absent (not `[]`) until the first section is added, and MUST be
  kept as `[]` if it was there and the last section is removed.
- **RB-DATA-02** `name`, every `dates`, and every skill are **plain text**. `contact`, `summary`,
  every `role`, every `details` and every `degree` are **rich text** (RB-DATA-03). Whitespace in
  every field is collapsed to single spaces and trimmed on save.
- **RB-DATA-03** Rich text is a string using only `<b>`, `<i>`, `<u>`, `<a href="…">` and
  `<font color="#rrggbb">` (RB-FMT-06), with `&`,
  `<` and `>` in the text escaped as `&amp;`, `&lt;`, `&gt;`. Nothing else is stored. The
  canonical nesting order is `<a><font><u><b><i>text</i></b></u></font></a>`; two spellings of the same
  formatting MUST compare equal, and a field the person did not edit MUST keep its exact original
  string.
- **RB-DATA-04** A link target MUST be `http:`, `https:`, `mailto:` or `tel:`. A bare domain such as
  `linkedin.com/in/jane` or `www.x.com` gets `https://`. Anything else (including `javascript:`
  and `data:`) MUST be dropped, leaving the text without a link. This is enforced on the client
  **and again in the backend** (the backend never trusts the client).
- **RB-DATA-05** An emptied skill is removed. A resume with no jobs or no schools keeps one blank
  row in the editor, and saves back as `[]` while that row is untouched.
- **RB-DATA-06** Skills added by Lay AI use the usual casing (`Docker`, `CI/CD`, `Node.js`,
  `PostgreSQL`; the table is `SKILL_CASING` in the rules file); any other skill gets a capital
  first letter. A skill already present (case-insensitive) is never added twice.

### 2.2 Custom sections and tables (RB-BLOCK)

`extra[i].body` is a list of **blocks** in the editor's JSON form. Only these exist:

| Block | Shape |
|---|---|
| paragraph | `{type:"paragraph", content:[inline…]}` |
| bullet list | `{type:"bulletList", content:[{type:"listItem", content:[paragraph]}…]}` |
| table | `{type:"table", attrs:{borders:"all"\|"light"\|"rows", borderWidth, borderStyle:"solid"\|"dashed"\|"dotted", cellPadding, cellGap}, content:[tableRow…]}` (RB-BLOCK-04) |
| table row | `{type:"tableRow", content:[tableHeader\|tableCell…]}` |
| table cell | `{type:"tableHeader"\|"tableCell", attrs:{colspan, rowspan, colwidth}, content:[paragraph\|bulletList…]}` |
| inline text | `{type:"text", text, marks?:[{type:"bold"}\|{type:"italic"}\|{type:"underline"}\|{type:"textColor", attrs:{color}}\|{type:"link", attrs:{href}}]}` |

- **RB-BLOCK-01** The backend MUST validate `extra` against exactly this list and reject (or strip)
  any other node type, mark, or attribute, and apply RB-DATA-04 to every `href`. Cells MUST NOT
  contain tables (no nesting). A section MUST have a non-empty title of at most 80 characters.
- **RB-BLOCK-02** A cell attribute that is only a default (`colspan` 1, `rowspan` 1,
  `colwidth` null) MUST NOT make two tables compare different.
- **RB-BLOCK-03** A new table section is an empty grid, like the table Word or Docs inserts: the
  title `New section` (as for any new section), 2 to 4 columns, two rows, every cell one empty
  paragraph, **visible lines** (a full grid, 1 pt, solid, as in RB-BLOCK-04) and no header row.
  Nothing is filled in, headed or suggested: no headings, no example text, and no mention of
  what the columns are for in the "Add section" list, which reads `Table: 2 columns`,
  `Table: 3 columns`, `Table: 4 columns`. The person types whatever they want. A row with no
  text adds no line to the ATS reading order (RB-ATS). "Insert table" in a text section makes
  the same plain grid.
- **RB-BLOCK-04** **A table's look is five attributes**, each always valid (RB-BLOCK-06):
  `borders` is which lines are drawn: `all` a full grid in black, `light` a full grid in grey, `rows` a
  line under each row; `borderWidth` is the line width in points, 0 to 6 in steps of 0.25 (default 1);
  `borderStyle` is `solid`, `dashed` (a line with breaks) or `dotted`; `cellPadding` is the space inside each
  cell, 0 to 12 pt in steps of 0.5 (default 4); `cellGap` is the space between cells, 0 to 12 pt in steps of 0.5
  (default 0, which joins the lines; above 0 every cell is boxed on its own, as with "allow spacing between
  cells" in Word). **A `borderWidth` of 0 draws nothing: the table is still there, with its cells and its
  text. This is the "table with the borders set to none" people build in Word for side-by-side lists, and
  it is a first-class feature** (and it needs no separate "none" setting). While **editing**, a table with
  width 0 shows faint dotted guides so the cells can be found; the guides MUST NOT appear in the finished
  resume, in an old version view, in print, or in an export. A dashed line gets longer dashes as the width
  grows. A table's look has no effect on the ATS reading order.
- **RB-BLOCK-05** Custom sections come after the built-in ones in one-column layout, and after
  Experience in the main column in two-column layout. They can be moved up or down past each
  other and deleted.
- **RB-BLOCK-06** A table attribute outside its limits MUST be brought inside them (rounded to the step), a
  word that is not on the list MUST be replaced by the default, and an empty or non-numeric number MUST be the
  default, not 0. A table saved with `borders: "none"` (an earlier version of the prototype) MUST be read as
  `borders: "all"` with `borderWidth: 0`, which looks the same; an explicit `borderWidth` wins over it.
  A table with only some of the attributes is the same table as one with the rest at their defaults, so an
  untouched section is never counted as edited.

### 2.3 The format (RB-FMT)

The format is how the resume is **set on the page**. It belongs to the document, is saved with it,
and is **not versioned**: changing the font size does not create a version.

| Key | Values | Default |
|---|---|---|
| `font` | `sans` (Plus Jakarta Sans), `serif` (Georgia), `classic` (CMU Serif, the LaTeX look) | `sans` |
| `fontSize` | 8 to 14 points, steps of 0.5 | 11 |
| `spacing` | `tight`, `normal`, `airy` | `normal` |
| `align` (header) | `left`, `center` | `left` |
| `bullets` (experience as bullets, one per sentence) | true, false | false |
| `style` (how Lay AI writes) | `formal`, `concise`, `friendly`, `beginner` | `formal` |
| `columns` | 1, 2 | 1 |
| `page` | `a4`, `letter` | `a4` |
| `unit` (rulers and Page setup) | `cm`, `in` | `cm` |
| `rules` (a line under section headings) | true, false | false |
| `hidden` (built-in sections not drawn) | any of `summary`, `education`, `skills` | `[]` |
| `marginTop`, `marginBottom`, `marginLeft`, `marginRight` | 5 to 50 mm, stored to 0.1 mm | 19.1 |

- **RB-FMT-01** Any value outside the table MUST be replaced by the default, silently (the backend
  does the same on every write). An older saved format with the single key `margins`
  (`narrow`, `normal`, `wide`) MUST load as the four margins of that preset.
- **RB-FMT-02** Margin presets: **Narrow** 12.7 mm all round (0.5 in); **Moderate** 12.7 mm top and
  bottom, 19.1 mm left and right; **Normal** 19.1 mm (0.75 in); **Wide** 25.4 mm (1 in). Margins that
  match none of them are shown as **Custom**.
- **RB-FMT-03** The text always keeps at least 60 mm of width and 80 mm of height: a margin cannot
  be set so that the other margin on its axis would leave less.
- **RB-FMT-04** Hidden sections keep their text, are not drawn (editor, old versions, finished
  page, print, export), and are left out of the ATS reading order. Experience and the header can
  not be hidden.
- **RB-FMT-05** A template sets `fontSize`, all four margins, `columns` and `font` when it is chosen
  (RB-TPL-02). The person can change each afterwards.
- **RB-FMT-06** **Text colour.** Selected text (or the text typed next) in any field that takes formatting can be
  coloured from the toolbar: the **A** button, with a bar in the colour at the caret, opens a palette of
  `Automatic (black)`, the nine colours of `TEXT_COLORS` (dark grey, navy, blue, teal, green, purple, red, orange,
  brown) and a custom colour. A colour is stored as `<font color="#rrggbb">` (RB-DATA-03) or as the
  `textColor` mark, always lower-case `#rrggbb` (a `#rgb` is spelled out). **A colour MUST have a contrast ratio of at
  least 4.5 against white** (WCAG, relative luminance); the backend MUST drop any other colour value (a name, `rgb()`,
  a pale or white hex) and keep the text, and the prototype refuses a pale custom colour with "That colour is too
  light to read on white paper." This keeps text from being made invisible, which the ML service would treat as hidden
  text (guardrail `no_hidden_text`). Colour has no effect on the ATS reading order, and a PDF export MUST keep it.

### 2.4 Versions (RB-VER)

A document has a list of versions, oldest first, and a `current` number.

```json
{ "number": 4, "source": "you", "summary": "You edited Summary", "at": 1793990000000, "resume": { } }
```

- **RB-VER-01** `source` is one of `template`, `import`, `you`, `ai`, `restore`. Version 1 is
  `template` ("Started from template Clean") or `import` ("Imported from upload, template Clean").
- **RB-VER-02** One version per committed edit. An edit is committed when the caret leaves the
  field it was in (moves to another field, or the editor loses focus to something that is not
  the toolbar), and only if the resume really changed. Typing and then undoing to the same text
  creates nothing. Summaries: `You edited <Name|Contact|Summary|Experience|Education|Skills|Custom section>`.
- **RB-VER-03** Changing the template adds a version, `Switched to template <Name>`. Changing the
  format (RB-FMT) does not.
- **RB-VER-04** Lay AI changes are versions with `source: "ai"`: `Lay AI: added Docker`,
  `Lay AI: removed SQL`, `Lay AI: shortened Summary`, `Lay AI: rewrote Summary`, and, for a suggestion the person accepted, `Lay AI: added <skill> (you
  accepted)` or `Lay AI: new Summary (you accepted)`.
- **RB-VER-05** Viewing an old version is read-only and shows a banner with **Restore this version**
  and **Back to current**. Restoring adds a new version, `Restored vN`, on top; nothing is deleted,
  so a restore can itself be undone by restoring again.
- **RB-VER-06** At most **50** versions are kept per document; the oldest are dropped first. The
  backend MUST enforce the same limit.
- **RB-VER-07** Writing a version is append-only and uses optimistic concurrency: a write names the
  version it was based on and fails with a conflict if the document has moved on.

## 3. Start, templates and the editor

### 3.1 Start and templates (RB-TPL)

- **RB-TPL-01** The start step asks: target role (text, up to 80 characters), experience (`student`,
  `fresher`, `junior` = 1 to 3 years, `senior` = 3+), style (`simple`, `modern`, `academic`,
  `classic`) and pages (1 or 2). The page limit is the answer to "pages".
- **RB-TPL-02** Templates, in a fixed catalogue. Every template has a size, margin and column setting
  that is applied when it is chosen:

| Id | Name | Columns | Text | Margin | Notes |
|---|---|---|---|---|---|
| `clean` | Clean | 1 | 11 pt | 19.1 mm | Plain headings; reads well in every ATS |
| `modern` | Modern | 1 | 11 pt | 19.1 mm | Accent colour on the name and headings |
| `compact` | Compact | 1 | 10 pt | 12.7 mm | Tighter, so more fits on one page |
| `academic` | Academic | 1 | 11 pt | 19.1 mm | Serif type, centred header, room for two pages |
| `classic` | Classic | 1 | 11 pt CMU Serif | 19.1 mm | The LaTeX look; **PDF only** (no DOCX) |
| `sidebar` | Sidebar | 2 | 10.5 pt | 15 mm | Education and skills in a side column |
| `executive` | Executive | 2 | 11 pt serif | 19.1 mm | Serif, centred header, two columns |

- **RB-TPL-03** The template page lists every template, best match first, with a filter (all, one
  column, two columns). The score of a template is 3 for the same style, 2 for the same page
  count, 1 when it suits the experience level; ties keep the catalogue order. The first card is
  marked "Best match", and every card says "One column" or "Two columns".
- **RB-TPL-04** Choosing a template when a document exists adds a version (RB-VER-03).

### 3.2 The editor (RB-EDIT)

The resume is edited **in place on the page**, by clicking and typing, in a real document editor.

- **RB-EDIT-01** The editor is a document shaped like a resume. A person can type only into its
  fields; they cannot delete a section heading, merge two fields, or drag content around. The
  prototype uses Tiptap (ProseMirror); another editor MAY be used if every requirement here holds.
- **RB-EDIT-02** One-line fields (name, dates, role, degree, skills): Enter ends the edit. Skills
  and bullets: Enter starts a new one; Backspace at the start of one (an empty one included) joins it to the one before. Pasting keeps the
  words only, as one line: no fonts, colours, line breaks or tables from Word or a web page.
- **RB-EDIT-03** Bold, italic, underline, text colour (RB-FMT-06) and link work from the toolbar, from Ctrl+B, Ctrl+I and
  Ctrl+U, and from a small floating bar that appears above selected text in a field that takes
  formatting. Undo and redo (Ctrl+Z, Ctrl+Shift+Z) work across the whole editing session.
- **RB-EDIT-04** The text size has A- and A+ buttons and a number box, in points (RB-FMT).
- **RB-EDIT-05** Experience can be shown as bullets: one bullet per sentence, joined back with a
  space on save. Two columns put education and skills in a narrower side column (left) and summary,
  experience and custom sections in the main column (right). The fields and their paths are the
  same in both layouts.
- **RB-EDIT-06** The status bar shows words and characters (text only, formatting ignored, custom
  sections and tables included) and "All changes kept · vN", or "Editing: kept as a version when
  you leave the field" while an edit is open.
- **RB-EDIT-07** A skill left empty when the person moves on is removed, but not while the mouse is
  still down (it would move the text under the pointer and turn a click into a drag).

### 3.3 Section and table tools (RB-SEC)

- **RB-SEC-01** "Add section" offers a text section, a bullet-list section, and a table of 2, 3 or 4
  columns. The new section's title is selected so typing renames it.
- **RB-SEC-02** When the caret is in a custom section a tool bar shows: Move up, Move down, Delete
  section, and Insert table (when the caret is not in a table). In a table it shows: add or delete
  a column or row, merge cells, split a cell, header row on or off, and Delete table; and, in a second
  group, the table's look (RB-BLOCK-04): which lines (full grid, light grid, row lines), the line style (solid,
  dashed, dotted), and number boxes in points for the line **Width** (0 hides the lines), the cell **Padding**
  and the **Gap** between cells. A box shows the value that was kept when it was changed (a width of 9 shows
  6). A tool that cannot apply is disabled.
- **RB-SEC-03** Every structural change is committed as a version at once (`You edited Custom section`).
- **RB-SEC-04** Table columns have equal width. Dragging column edges is not part of the prototype.

## 4. The page

### 4.1 Paper, margins, rulers, zoom (RB-PAGE)

- **RB-PAGE-01** The resume is drawn at true paper size: A4 is 210 × 297 mm, Letter is 215.9 × 279.4 mm,
  at 96 pixels to the inch. The page count shown is therefore real.
- **RB-PAGE-02** Each of the four margins is set separately, in the unit the person chose, three ways that
  stay in step: a **handle on the ruler** (drag, which snaps to 0.5 mm, or the arrow keys, 1 mm a press and 5 mm with Shift), the
  **Page setup** dialog (Top, Bottom, Left, Right, and the presets of RB-FMT-02), and a template.
- **RB-PAGE-03** Rulers sit along the top and down the left of the page being edited: centimetres
  (a tick every millimetre, longer at 5 mm, numbered each centimetre) or inches (a tick every
  eighth, longer at the half, numbered each inch). The margins are shaded; a handle marks each
  margin and shows its value while dragged or focused. Rulers are not shown on an old version, on
  the finished page, or in print.
- **RB-PAGE-04** Zoom: **Fit width** (default) draws the page as wide as the space allows, up to 150%;
  or a fixed 75, 100, 125 or 150%. A fixed zoom wider than the space scrolls sideways inside the
  page area. The choice is remembered per viewer on that device only.
- **RB-PAGE-05** The builder uses the whole window width: no fixed maximum for the page, toolbar, status
  bar or Lay AI panel.
- **RB-PAGE-06** The status bar shows how full the page limit is: `Fits 1 page · 55% full` or
  `Over the 1-page limit by 14%`. Past one page a line marks where each page ends; the text is
  not re-flowed around it.
- **RB-PAGE-07** "How full" is the height of the content plus the top and bottom margins and the
  2 px border, measured at true size, divided by the page height; it fits if it is at most the
  limit plus 0.003 of a page.
- **RB-PAGE-08** Page limit is 1 or 2 pages, set in the toolbar, the Page setup dialog, or by asking Lay AI
  ("fit it on one page" sets 1, "…two pages" sets 2).

### 4.2 Fit to page (RB-FIT)

"Fit to page" and the Lay AI request make a resume fit its page limit **by changing how it is set,
never what it says**. It is a deterministic algorithm, not a language model.

1. If it already fits, change nothing.
2. Otherwise tighten, in this order, stopping the moment it fits: line spacing `airy`→`normal`→`tight`;
   then margins, narrowing every margin that is wider than 25.4 mm to 25.4 mm, then wider than 19.1 mm
   to 19.1 mm, then wider than 12.7 mm to 12.7 mm; then the text size down in 0.5 pt steps to **9.5 pt**.
3. Nothing is ever made bigger. A margin already below a step is left alone. The smallest text size
   Lay AI will use is 9.5 pt (the person may go to 8 pt by hand).
4. It never deletes, shortens or rewrites text, and never changes columns, template or the hidden sections.

- **RB-FIT-01** The algorithm MUST be bounded: at most 20 layout measurements, whatever the content.
- **RB-FIT-02** The result reports what changed, as a sentence: `Done: it fits on 1 page now. I tightened
  the line spacing, narrowed the margins to 12.7 mm and reduced the text from 11 to 10 pt. Every word is
  still there.` When nothing changed: `It already fits on 1 page: 55% of the space is used. I changed
  nothing.`
- **RB-FIT-03** When it cannot fit, it keeps the tightest setting, deletes nothing, and says so: `It is
  still 139% too long for 1 page, even at the smallest setting I use (9.5 pt, 12.7 mm margins, tight
  spacing). I have not deleted anything. To make room, try "Shorten my summary", or allow 2 pages.`
  (for a 2-page limit the last clause is `or trim your oldest role`).
- **RB-FIT-04** A chat message is a fit request when it names a page and a fitting verb ("fit it on one
  page", "squeeze everything into two pages") or asks to fit the whole resume. "Make it fit a DevOps
  role" is **not** a fit request. A request is handled by the algorithm above, never sent to the model.

### 4.3 Page setup dialog and reading order (RB-ATS)

- **RB-PAGE-09** **Page setup** holds: paper size, units, margin preset and the four margins, columns, the
  page limit, "draw a line under section headings", and which built-in sections are shown. Changes apply
  as they are made.
- **RB-ATS-01** "How an ATS reads this" shows the resume as plain text in the order a parser meets it:
  header (name, contact); then sections in page order (in two columns the **main column before the side
  column**); a job as `role | dates` then its text or `- ` bullets; a school as `degree | dates`; skills
  as one comma list; a custom section as its title then its blocks; a table **row by row, cell by cell**,
  cells joined by ` | `, the bullets inside a cell joined by `; `. Hidden sections are left out.
- **RB-ATS-02** Beside the text it lists one plain note for each choice parsers can trip over: two columns
  (main first, then side; some parsers read straight across), and each table (read cell by cell; keep job
  titles, dates and employers out of tables). A one-column resume with no tables says it is the safest
  layout. This text MUST be the same text the PDF's text layer contains, in the same order (RB-EXP-02).

## 5. Lay AI in the builder (RB-AI)

### 5.1 The panel

- **RB-AI-01** A floating Lay AI button (a black square with a white triangle pointing up) opens a right-hand
  panel with two tabs, **Chat** and **Versions**. When the panel is open the triangle in its header points
  down. The panel can be resized by dragging its left edge (width 300 to 720 px) and bottom edge (height at
  least 420 px), by arrow keys on those edges, and reset with Home or a double-click; the size is remembered on
  that device. On a phone the panel is a bottom sheet and is not resizable.
- **RB-AI-02** Chat keeps the last 60 messages. Quick prompts: "Fit on one page", "Fit a DevOps role", "Add
  Docker and Kubernetes", "Shorten my summary", "Fit a senior backend role".
- **RB-AI-03** Versions lists every version newest first with its source, summary and time, and a View and a
  Restore action (RB-VER-05). A **Versions** shortcut in the page opens this tab. The versions of
  *uploaded* resumes are a different list; see RB-UI-04.

### 5.2 What Lay AI may do

- **RB-AI-04** **Suggest, never take over.** Lay AI proposes changes the person adds one by one. It never writes a whole
  resume from nothing, never adds a skill, job or result the resume does not already support, and says what
  is missing instead of inventing it (`Not in your resume yet: add it only if you have used it.`).
- **RB-AI-05** Direct requests change the resume at once and create a version: add or remove skills ("Add Docker
  to my skills"), shorten the summary, rewrite the summary for a role in the chosen writing style.
- **RB-AI-06** "Fit to a role" ("Make it fit a DevOps role") answers in **suggest mode**: a list of items, each with
  Add and Skip. A skill item shows the role's market share, evidence from the resume, and a status (`open`,
  `have`, `added`, `skipped`); a summary item shows the old and new text. Nothing changes until Add is pressed.
- **RB-AI-07** A suggestion message has this shape, and the ML service MUST return exactly it:

```json
{ "from": "lay", "kind": "suggest", "text": "…", "role": "DevOps Engineer", "items": [
  { "id": "skill:Terraform", "kind": "skill", "skill": "Terraform", "share": 41, "evidence": "…", "status": "open" },
  { "id": "summary", "kind": "summary", "before": "…", "after": "…", "status": "open" } ] }
```

- **RB-AI-08** Every change Lay AI makes is **highlighted** on the page until the next change, and the cursor goes
  to it (RB-AI-10).
- **RB-AI-09** **Privacy.** What the person types in the chat passes the personal-data guard before it is stored,
  logged or sent to a model: names, colleges, companies, emails, phone numbers and links become placeholders
  (`{user.name}`, `{user.college}`, `{user.email}`, `{user.phone}`, `{user.company}`, `{user.link}`,
  `{other.person_1}`); the real values live only with the account and are filled back in on the person's
  screen. The chat shows a lock chip and a "What we store" view with the placeholder text. Lay AI sees and
  answers with placeholders only.

### 5.3 The Lay AI cursor

- **RB-AI-10** **Watching.** While the person types, a cursor labelled `Lay AI · watching` sits beside the caret.
  After 0.9 s without typing it may show **one** short tip for that field: summary (more than 60 words:
  "Two or three sentences read best."; no number: "A number (users, %, time saved) makes this stronger."),
  experience details (no number; or starting with "I", "My", "Was" or "Responsible"), contact without a link
  ("Add your LinkedIn: select text, then the link button."), and a skill ("List the tools you used at work
  first."). The tips never call a model.
- **RB-AI-11** **Editing.** When Lay AI changes the resume the cursor jumps to the changed field, is labelled `Lay AI is
  editing…`, and stays for 2.8 s. **The page MUST scroll that field into the middle of the window if it is off
  screen or near an edge**, smoothly (instantly when the person asked for reduced motion), so the person
  always sees the change. Moving focus to the chat box MUST NOT cancel that scroll. If the field is in a hidden
  section there is nothing to point at, and the cursor stays away.

## 6. The rest of the screen

### 6.1 The look (RB-UI)

- **RB-UI-01** One theme: a white page, black text and borders, greys for fills, **Inter** for the interface and **Source Serif 4** for headings (changed 11 Nov 2026 from Fira Mono: simpler to read). No dark mode. White and black stay the theme (white page, white cards, 1.5px outlines, hard offset shadows). Colour is an accent only (changed 11 Nov 2026):
  blue (`#2a52e0`, the opposite of the logo's orange) on the primary button, the current-page marker (pale blue `#d6e2ff`), the active tab and the
  headline highlight. No tinted pages, bands or cards, no pink, and no orange outside the logo. **Sign out** is red (`#c4161c`) at all times and solid
  red with white text when pointed at or focused. Colour as a signal appears on
  the product's own results, namely the ATS score, its bar and ring and its checks (green good, amber partial, red to fix),
  the role match percentage, the skills you have (green) and the skills to add (amber), the status badges, and the
  icon tile of each landing feature. Status is still written in words, so nothing depends on hue alone, and every
  colour pair has a contrast ratio of at least 4.5. The development build shows a demo account on the sign-in page.
  The other exception is the swatches of the text colour
  palette (RB-FMT-06), which are the choices themselves. The documents the person makes are not interface: the
  resume paper, the letters and the analyzer's view of the resume use the document fonts of RB-EXP-03, not the interface fonts (a monospace body does not read as a resume). The resume is white paper; a template may colour its own headings.
- **RB-UI-02** The toolbar has two rows with every control the same height and centred on the row: row one for
  text (undo and redo; font and size; bold, italic, underline, text colour, link; bullets, header alignment, spacing), row two
  for the page and content (add section; columns, page limit, Page setup, Fit to page; then writing style). The
  section and table tools sit in a bar of the same kind below it. **Every group is laid out from the left, one
  after another, and none is pinned to the right edge**: a group pinned to the right jumps sideways whenever the
  Lay AI panel opens or closes and floats far from the tools it belongs with. Each row stays on one line when the
  toolbar is wide enough (about 980 px of content), the groups divided by thin lines. The width that counts is the
  toolbar's own, so opening the Lay AI panel narrows it; below that width the groups wrap like words, with no
  dividing lines. A group never changes height or its place in the row's order. "Add section" has a fixed width,
  so the options in its list never widen the row.
- **RB-UI-03** The sidebar has three parts: the account and brand fixed at the top, the navigation in the middle
  (the only part that scrolls; it has no admin links, the admin console is a separate window, RB-ADM-01), and **Report a bug** and
  **Sign out pinned at the bottom** so they are always visible and never scroll away.
- **RB-UI-04** **Resume versions are not listed in the sidebar.** A page that uses the resume shows a version menu
  in its top bar: one button (`Analysis of v3`, `Ranked with v3`, `Written from v3`, `Uploaded v3`) that opens a
  short list, newest first, with the date, the current one marked, a fixed maximum height that scrolls, and
  "Upload a new version". It closes on Escape or a click elsewhere. Choosing a version opens it in the Resume
  analyzer. The Resume analyzer keeps its own version selector. The Resume Builder's own versions are in the
  Lay AI panel (RB-AI-03).
- **RB-UI-05** Everything works with the keyboard; every control has a visible focus ring and an accessible name.
- **RB-UI-06** The builder is called **Builder** in the sidebar and in the page title (it was "Resume Builder"). This document still
  says "the Resume Builder" for the feature; the pages and the paths (`resume-builder.html`) keep their names.
  Motion is limited to the Lay AI button's float and the cursor's move, and stops for reduced motion.

### 6.2 Export (RB-EXP)

- **RB-EXP-01** The finished resume shows **Download PDF** (the prototype uses the browser's print to PDF with the
  paper size set to the format's page and zero page margin, so the format's margins are the page margins) and
  **Download DOCX**, which writes a real Word file (RB-EXP-04). Classic is PDF only.
- **RB-EXP-02** The real PDF and DOCX MUST reproduce the page: paper size, the four margins, columns, font and size,
  spacing, bold, italic, underline, text colours, links, bullets, tables with their borders (none, rows, light, all), hidden
  sections left out, section lines on or off. The PDF MUST have a text layer in the reading order of RB-ATS-01 and
  MUST NOT put contact details in a page header or footer. A two-column DOCX MUST use real section columns, not text
  boxes. A table MUST be a real table with its line style, width, cell padding and cell spacing as set; a width
  of 0 MUST be a real table with its borders set to none (0 pt), so it stays editable in Word.
- **RB-EXP-03** Fonts: `sans` is Plus Jakarta Sans, with the section headings and dates in JetBrains Mono; `serif` is
  Georgia; `classic` is CMU Serif (Typst with New Computer Modern for the PDF). The exported file embeds its fonts.
  The same Plus Jakarta Sans is the type of the other documents (letters, the analyzer's view of the resume).
- **RB-EXP-04** **The prototype's DOCX is real.** `resume-docx.js` writes it from the same editor document the page shows,
  with `docx-writer.js` (no library: a zip of WordprocessingML). It has the name and contact line with a rule under it,
  the sections in order with small-capital headings, dates at the right edge (a right tab), bullets as real list
  items, text colours, links (a relationship per link), custom sections and tables (borders, line style and width,
  padding, spacing between cells, merged cells), the page size and the four margins, and, with two columns, a header
  section followed by two real section columns with a column break. The font is Calibri for `sans` and Georgia for `serif`
  (Word does not have Plus Jakarta Sans). The file is named `Name-Resume.docx`. The real backend MUST produce a file with
  the same content and structure (RB-EXP-02); it was checked by opening the prototype's files in LibreOffice.

### 6.3 The applications board (RB-APP)

The Applications page (`frontend/src/applications.html`, rules in `applications-rules.js`, tests in
`applications-rules.test.js`) is a board of five columns: **Preparing, Applied, Interview, Offer, Rejected**.

- **RB-APP-01** An application has `id`, `company`, `role`, `portal` (`Company site`, `LinkedIn`, `Naukri`, `Referral`,
  `Other`), `status`, `createdAt`, `updatedAt`, `appliedAt`, `checkInAt`, `resumeVersion` and one `reminder`
  (`{kind, text, dueAt}`) or none. A new one starts in Preparing with a reminder in 3 days.
- **RB-APP-02** **A card moves three ways, and all three are the same move:** drag it onto another column; choose a column in
  its **Move to…** menu; or press the button on the card (the next column: Preparing to Applied, Applied to Interview,
  Interview to Offer). The menu and button stay for the keyboard and for touch; dragging is never the only way.
- **RB-APP-03** A move does the same everywhere: it stamps `appliedAt` the first time a card reaches Applied; it sets the
  "Did you hear back?" check-in for 7 days after a move to Applied (and clears it otherwise); it sets the one reminder for
  the new column (Preparing: send the application, in 3 days; Applied: follow up if you haven't heard back, in 7 days;
  Interview: read the job post and the resume version again, in 1 day; Offer and Rejected: none); the newest change is
  first in its column. Dropping a card on its own column changes nothing. An unknown status changes nothing.
- **RB-APP-04** While a card is dragged: the card is faded with a dashed outline, every column other than the target gets a
  dashed border, and the column under the pointer shows a dashed white drop zone (not for the card's own column). When the
  drag ends every one of those marks is removed. The move is announced to screen readers ("Platform Engineer at Razorpay
  moved to Interview."), and the card that moved is scrolled into view and outlined for a moment.
- **RB-APP-05** The outcome insight (Interview, Offer, Rejected) stores only the analytics id, role, experience band, skills,
  resume version and outcome: never a company contact, a name or an email, and the card shows exactly that record.
- **RB-APP-06** **Lay AI is on this page** as the black-square button at the bottom right, opening a panel docked to the right
  edge (a bottom sheet on a phone) beside the board, with greeting, quick prompts ("What's due?", "Who hasn't replied?",
  "Where are my rejections?", "Status of Swiggy", "Move Razorpay to Applied") and a box. It is the one Lay AI of RB-LAY-01
  (the same chat as every other page), with the board's own answers added; Lay AI's own work (RB-LAY-03) is answered first.
- **RB-APP-07** Lay AI answers from the person's own board: what is due in the next two days; which applications sent a week
  or more ago have had no news; a summary (count per column and the one that needs the person most); the status of one
  application found by company first and then role words; what to do to prepare for an interview.
- **RB-APP-08** **Lay AI only proposes a move.** For "move Razorpay to Applied", "I got an offer from Zerodha" or "Freshworks
  rejected me" it asks first and shows **Move it** and **Not now**; the board changes only when the person presses Move
  it. A card already in that column is reported, not moved; a message that names no application asks which one.
- **RB-APP-09** When an answer is about a card, that card is scrolled into view and outlined, as in RB-AI-11.
- **RB-APP-10** Replies are at most 80 words, plain, and have no exclamation marks; when Lay AI cannot find what was asked it
  says so and says how to ask, and it never invents an application. In the prototype nothing is sent anywhere (the chat is
  kept on the device, RB-LAY-02); in the real build it follows RB-AI-09 and ML-01 to ML-07: the board is data, placeholders
  replace personal values, and moving a card is always the person's action.
- **RB-APP-11** **A card has the person's own notes.** Every card has one small **+ Notes** button (a pill, not a window). Pressing it opens a text box
  under the card: interview dates, who they met, the questions asked, what went well, what a rejection taught them. While a card has no note the
  button says **+ Notes**; once it has one it says **Notes** with the word count. The box's hint follows the column (Preparing: who to ask for, what to
  read first; Applied: who you wrote to, when to follow up; Interview: date, interviewers, questions asked; Offer: pay, joining date, what to ask;
  Rejected: what you were told, what you would do differently). A note is kept as the person types (after half a second, and at once when they leave the
  box), is at most 2,000 characters, and keeps its line breaks and at most one blank line in a row. The box stays open across a move, the board is not
  redrawn while typing (the caret stays), and a card cannot be dragged while its note has the focus (so text can be selected). Writing a note is not a
  move: it does not change the status, the dates or the reminder. An emptied note removes the field. (`setNotes`, `cleanNotes`, `notesPlaceholder` in
  `applications-rules.js`.)
- **RB-APP-12** **Notes are private to the person.** A note is never part of the outcome record the insights keep (RB-APP-05 picks its fields one by one, and
  `applications-rules.test.js` pins that a note cannot appear in it); it is not shown to anyone else; and Lay AI reads it only when the person asks to
  prepare for that application ("Prepare for Zerodha"), never for a status or a summary. In the real build the note is the `notes` column of
  `job_applications` (owner-only, text, at most 2,000 characters), it is in the person's export, and it is deleted with the application and with the account.
- **RB-APP-13** **Where a rejection is kept.** A rejected application is not deleted and not hidden: it stays on the board in the **Rejected** column with its
  dates, its resume version and its notes. The only other copy is the anonymous outcome record (role, experience band, skills, resume version,
  `outcome: rejected`; RB-APP-05), which carries no company, name or note. Asking Lay AI "Where are my rejections?" says exactly this, from the board:
  how many, which (up to three by name), whether they have notes, and where they are kept (`rejectionsSummary`). There is no separate rejection
  history or reason list in this version; the note is where the person writes why.

### 6.4 The community (RB-COM)

The Community page (`frontend/src/community.html`, rules in `community-rules.js`, tests in
`community-rules.test.js`) is a feed of anonymous posts by topic (Interview experience, Salary & offers, Referrals,
Company culture, Career advice).

- **RB-COM-01** **Every post is shown as "Anonymous".** There is no handle, nickname, pseudonym, "mask", colour, avatar,
  initials or any other mark that differs between writers, so nobody can tell that two posts came from the same
  person. All posts sit under the same umbrella. The author line, the composer and the button all say "Anonymous".
- **RB-COM-02** A post stores only its topic, its optional company (up to 60 characters), its text (20 to 1,000
  characters), the **hour** it was made (never the exact time) and its upvote and downvote counts. It MUST NOT store, log, index or
  send to analytics the account id, any device id, IP address, user agent, session, exact time, or anything else that
  could link a post to an account or two posts to each other. The community routes MUST NOT carry the login token.
- **RB-COM-03** Each post is authorised by its **own one-time pass**, made on the device and signed by the backend
  **without seeing it** (a blind signature, RFC 9474). The backend verifies the signature and marks the pass spent, and
  learns nothing about who sent it. The backend records only how many passes an account has been given.
- **RB-COM-04** The device keeps, privately, a list of its own posts and a count of its posts and points. That is the only
  place "Your posts" exists: the side card shows the counts, and the label **"You"** appears on the person's own posts on
  their own screen. It is worked out on the device from its own list and MUST NOT be sent or stored on the server. A
  person can delete their own post from the device that made it, using a secret only that device holds for that post;
  Coverlay cannot list or delete "all posts of an account" because it cannot find them.
- **RB-COM-05** Each post earns 5 points. Points are collected on the device as blind-signed reward tokens of one fixed
  value and move to the wallet in small batches at random times (within a day), so amounts and timing do not point back to
  a post. In the preview the points reach the wallet at once.
- **RB-COM-06** Before a post goes up, the check looks for what would identify the writer (their name, college, company,
  email, phone, links) and offers a neutral version ("my college", "[email removed]"); the person may use it or edit the
  post themselves. Nothing is posted until the check passes or the person has chosen.
- **RB-COM-07** **How Coverlay limits abuse is the owner's internal decision and is not shown to the person.** Whatever is
  chosen (how many passes an account gets, removing posts one by one, rate limits, reports) MUST NOT require linking a post
  to an account or two posts to each other. Consequences the owner accepts: there are no per-person bans and no reputation.
- **RB-COM-08** Older saved previews that still hold mask handles are converted when they load: handles and author ids are
  dropped, and the posts that were the person's own become theirs on this device.
- **RB-COM-09** **Upvotes (agree) and downvotes (disagree) are two separate counts.** Every post and every comment shows an up arrow with its
  upvote count and a down arrow with its downvote count. There is no combined score: how the two counts are shown, weighed or used for ranking
  is the backend's decision, and people who agree and people who disagree are kept apart. **A device has one vote per post or comment, and it is
  never locked:** pressing the same arrow again takes the vote back, and pressing the other arrow switches it. The chosen arrow is filled (blue for
  up, red for down; `aria-pressed`). **No stored counter ever goes down:** each post and comment has four increment-only counters, `upvotes` and
  `downvotes` (votes given) and `upvotesWithdrawn` and `downvotesWithdrawn` (votes taken back, including switching away). A new vote adds one to
  its given counter; a take-back adds one to its withdrawn counter; a switch does both. The count shown is given minus withdrawn, never below zero
  (`voteCounts`). So the server never subtracts or handles a negative value, and can apply votes in any order without locks or transactions;
  exact ordering is not required. Which way this device voted is kept on the device alone (`votes`: id to 1 or -1), never on the server; in the
  real build each vote, take-back or switch is authorised like a post (RB-COM-03), so the server cannot tell who voted, or that two votes came from
  one person. An older tally's "Useful" marks become upvotes. (`vote`, `voteOf`, `voteCounts`.)
- **RB-COM-10** **Anonymous comments in branches, as on Reddit.** A post has a **Comment** button (or "N comments") that opens a box under the post;
  every comment has a **Reply** button that opens a box under that comment. A reply sits under its parent, indented, with a thread line down its
  left side; branches go at most 6 levels deep, and at the deepest level the comment says "This branch is as deep as it goes; reply higher up".
  In the prototype siblings are sorted by the most upvotes, then the fewest downvotes, then the older one (the real ranking is the backend's). Pressing **[–]** or the thread line collapses the whole branch to its
  head line, which then says how many replies are hidden ("3 more replies"); **[+]** opens it again (for this visit only). Each comment's head line is
  "Anonymous" and the hour (a collapsed one adds its up and down counts). A comment is 5 to 500 characters, goes through the same identity check as a post (RB-COM-06),
  stores only `{id, parentId, text, createdHour, upvotes, downvotes}`, and earns no points. A comment whose parent is gone is shown at the top level.
  The device keeps its own comments as `{id, postId}` so it can show **"You"** on them and list them on My activity; the server never knows whose
  comment it is. (`validateReply`, `addReply`, `replyDepth`, `replyTree`, `branchSize`, `isMyReply`.)
- **RB-COM-11** **Posts viewed.** A post counts as viewed once 60% of it has been on screen; each post once, never the person's own, at most 500
  remembered (`markViewed`). The list is on the device only and is not sent anywhere (a view log on the server would link reading to an account).
  The side card shows posts, points, comments and votes, and links to My activity.

### 6.4a My activity (RB-ACT)

The My activity page (`/activity`, Account group of the sidebar; rules in `activity-rules.js`, tests in `activity-rules.test.js`) is the signed-in
person's own analytics. Nobody else sees it, and it is never part of the admin console (RB-ADM-04).

- **RB-ACT-01** **Applications and jobs.** Four tiles: **Applications sent** (cards that have reached Applied, even if later moved to Interview, Offer
  or Rejected; with the number on the board and the number sent in the last 30 days), **Job postings opened** (with the last 7 days), **Saved jobs**
  (from the saved-jobs list, with how many are marked Applied or further; Not selected counts as applied), and **Interviews and offers** on the board.
  Below them, the board's count per column as bars, and the last five postings opened. (`activitySummary`.)
- **RB-ACT-02** **Community, this device only.** Four tiles: **Posts viewed** (RB-COM-11), **Upvotes given** (with the downvotes; RB-COM-09),
  **Anonymous comments** (RB-COM-10) and **Your posts** (with points waiting). Below them, the person's comments (text, its up and down counts, the comment it
  replies to or the post it is on, topic, hour) and what they upvoted (posts and comments, with both counts). The section is labelled **This device only**, and the page says that Coverlay never links a post, a vote or a comment to the account,
  so another browser or phone starts at zero. This is the price of RB-COM-02 and RB-COM-04 and MUST NOT be "fixed" by storing it on the server.
- **RB-ACT-03** **Job postings opened.** Pressing **Apply** or **View posting** on Jobs for you, or **Posting** on Saved jobs, records
  `{jobId, title, company, at}`: each posting once (opening it again moves it to the top), newest first, at most 200 (`recordJobOpen`). In the
  prototype it is kept in this browser; in the real build it SHOULD be an owner-only server table (job views are not anonymous), in the person's
  export and deleted with the account.
- **RB-ACT-05** **Skills and education** come first on the page. Four tiles: **Total skills** (with where they came from), **Education** (the number of
  entries, with the first degree and year), **Skills to add** and **Role matches** (with the domain). Below them, **Your skills** as green chips, then
  **Skills your role matches ask for** as amber chips (each role's missing skills counted across the matched roles, most asked first, without the
  ones the person has, ignoring case; at most 8; "×3" when three roles ask), and **Education** as a list (degree, institution, year). The source is
  the latest uploaded resume as the system read it (`GET /resumes/{id}/profile`: `skills`, `education`); when there is no upload yet, or it has
  neither skills nor education, the Builder resume (its Skills and Education sections) is used instead, and the page says which ("From your resume,
  version 3" or "From your Builder resume"). Skills are de-duplicated ignoring case, keeping the first spelling. The role matches are the dashboard's
  (`GET /recommendations/dashboard`). (`profileSummary`, `skillGaps`.)
- **RB-ACT-04** A count of zero says so plainly, with what to do to fill it ("Use the up arrow on a post or a comment in the community."). A comment or upvoted post or comment whose
  post is no longer in the feed is still counted but not listed.

### 6.5 Letters and emails (RB-LET)

- **RB-LET-01** The page has two kinds of draft, a **cover letter** and a **cold email**, three templates each, written for a
  job the person picks. A draft is written with placeholders (`{user.name}`, `{other.person_1}`) and filled in on the person's
  own screen; an edit goes back through the guard (RB-AI-09, RB-LET-09); a suggestion changes the draft only when the person adds it and
  uses only facts that are in the resume. Each suggestion reads in one order: its title (with "Added" or "Skipped" beside it once decided), the
  sentence it would add, then **Add** and **Skip** under the sentence at the left; the card stays in view beside the draft as the page scrolls.
- **RB-LET-02** **Length.** A cover letter is about a page: **250 to 400 words**, a greeting (`Dear {company} hiring team,`), six
  paragraphs (the opening; what the person did; how they fit the job's skills; why this company; how they work; the close) and a
  sign-off. The note under the draft reads `N words · good length` inside the range, `N words · a cover letter usually runs 250
  to 400` below it and `N words · aim for 400 or fewer` above it. A cold email is short: at most 120 words (`aim for 120 or
  fewer` above that), with no greeting field (its first paragraph says hello).
- **RB-LET-03** **A cover letter downloads as PDF or as DOCX.** Copy, PDF (the browser's print) and DOCX sit above the draft.
  The DOCX is a real Word file (`letter-docx.js`): the greeting, the paragraphs and the sign-off lines as the page shows them,
  on A4 with one-inch margins in Calibri 11, named `Name-Company-Cover-Letter.docx`. **A cold email is not a file**: it has no
  PDF and no DOCX button, only Copy and the Gmail actions of RB-LET-04, because an email someone must download, attach and send by hand
  is not an email.
- **RB-LET-04** **Send from Gmail.** Under a cold email a panel offers **Connect Gmail**. Once connected it shows the account
  with **Disconnect**, a **To** box, an **Attach** list and two buttons: **Save as Gmail draft** and **Send with Gmail**. The
  resume (PDF or DOCX; DOCX is not offered for Classic) and the cover letter for the chosen job (PDF or DOCX) are on by default and
  go in the same message, so nobody attaches three files by hand. A draft may leave To empty; a send needs one valid address.
  **Send with Gmail** asks again ("Send from ... to ... with ... Coverlay sends it when you press Send now, and nothing
  sooner") and puts the focus on Cancel, so Enter cannot send by accident. The checks are `buildMailRequest()` in `mail-rules.js` and the backend MUST repeat them:
  one address only (no list, no `Name <a@b.com>`, at most 254 characters, lower-cased); the subject one line of at most 200
  characters (a line break could add a mail header); a non-empty body of at most 20,000 characters; each attachment kind at most
  once, `resume` or `cover`, `pdf` or `docx`; nothing else in the request.
- **RB-LET-05** **Providers.** Only Gmail works now. The request names its `provider`, so Outlook and other mail services can be
  added without changing its shape; until then they are refused with "Outlook is not available yet. Gmail is." The panel says so.
- **RB-LET-06** **Only the person sends.** Nothing is saved to a mailbox or sent unless the person presses the button; Lay AI never
  sends, never fills in an address, and never follows up by itself. One send is one message to one address (no Cc, no Bcc). The
  backend MUST limit sends per account per day (the number is the owner's policy).
- **RB-LET-07** **The real Gmail integration** (backend, not in the prototype). OAuth 2.0 authorisation-code flow with PKCE, signed in
  with the person's own Google account. **Saving a draft needs the `gmail.compose` scope** (drafts and sending). Google classes that
  scope as *restricted*: before a public launch the app needs Google's verification and a security assessment. A send-only
  integration would use `gmail.send` (a *sensitive* scope, a lighter review) but could not save drafts. **Which to ship is the
  owner's decision** (open). Never ask for a read scope: Coverlay does not read the inbox. Refresh tokens are encrypted at rest,
  removed on Disconnect and when the account is deleted, and revoked at Google. The server builds the message (MIME) with the
  attachments made from the stored resume version and cover letter, fills the placeholders last (RB-AI-09), and logs neither the
  subject nor the body. The endpoints are in section 9.1.
- **RB-LET-09** **The draft is edited in place.** The draft is the editing surface: click anywhere in the text and type, as in a document.
  It says so: a line above the toolbar ("Edit it right here. Click anywhere in the draft and type."), the paragraph under the pointer is
  outlined with a dashed line, and the toolbar is **sticky**, so it stays at the top of the window while a long letter scrolls under it.
  The toolbar is **one row** (a second row would hide more of the letter under it): the tools at the left, and at the right end the state of
  the text (empty until something is edited, then "Editing…" and "All changes kept") and **Start over**. It wraps only when it is too narrow for one row,
  and then without dividing lines. The toolbar has **Undo** and **Redo**, **Bold**, **Italic**, **Underline**, **Link** and **Start over**, which writes the draft
  again from the template: it asks again with "Discard edits?" (a second click within four seconds confirms), because it throws the edits away. Enter starts a paragraph, Shift+Enter a line break
  (the sign-off is one paragraph of lines), and pasting keeps the words only (a blank line starts a paragraph). A cold email also has its
  **Subject** in a box above the draft, edited the same way. The draft is a list of **blocks**, each one paragraph of rich text in the
  resume's small markup (RB-DATA-03: `<b>`, `<i>`, `<u>`, `<a href>`; no colour; `\n` for a line break); the greeting is the first block and
  the sign-off the last, and blank paragraphs are not kept. What the person types goes back through the guard before it is kept (their name,
  college, email and phone become placeholders again; the prototype checks each piece of text on its own, so the server MUST run the guard
  over the whole text). It is kept about a third of a second after the last keystroke or when focus leaves, per type, template and job,
  until the person starts from the template again. A suggestion adds its sentence to the edited text (once, to the same paragraph as for the
  template), and the word count and the length note follow every edit. "What Gemini sees" shows the kept text with the placeholders marked,
  without formatting and with nothing to edit. The PDF, the DOCX, Copy and the Gmail message all carry the edited text; an email carries it as
  plain text and, so that bold, italics and links arrive, also as an HTML part made from the same markup (`bodyMarkup` in the request, written one way).
- **RB-LET-08** **In the prototype nothing is saved or sent.** Connecting only flips a switch on this browser, the account shown is a
  sample (`jane.doe@gmail.com`), and every result says so ("Sample: the preview sends nothing.").

### 6.6 Connected apps and connectors (RB-CON)

- **RB-CON-01** **Settings & privacy has a Connected apps card**, between Account and Privacy: one row per service with its name, a badge, what
  Coverlay uses it for, what it asks the service for, and the one thing the person can do. Nothing is linked until the person connects it, and it
  can be disconnected at any time. A line under the list says Lay AI uses a connected app only when asked, only for the person's own request, and
  never applies, sends or posts by itself.
- **RB-CON-02** **The services, and what each one can be** (`connections-rules.js`): **Gmail** is the only one that can be connected now (Connect and
  Disconnect buttons; the same connection as the Letters page, RB-LET-04; asks to save drafts and send the messages the person chooses, and cannot
  read the inbox). **LinkedIn** is *import only*: LinkedIn lets only approved partners read profiles and forbids scraping, so there is no sign-in; the
  person saves their profile to PDF and brings it in. **Company job boards** (Lever, Greenhouse, Ashby) are *built in*: public pages, nothing needed from
  the person. **Job search services** (Adzuna, JSearch and others) are *planned*, to carry jobs in every field. **Naukri** is *not available*: it has no
  public job search API and does not allow scraping, so Coverlay MUST NOT read it unless it offers a partner API. **Your own connector (MCP)** is
  *planned*. A service that cannot be connected cannot be switched on by any request, and the screen says why in words.
- **RB-PIC-01** **Profile picture.** Settings & privacy opens with a **Profile picture** card: the current picture in a 96 px circle, **Upload a photo** (or
  **Change photo**), **Remove**, and eight ready-made avatars to choose from (`AVATARS` in `avatar-rules.js`: Sky, Mint, Sun, Coral, Violet, Slate, Ink,
  Sand, each a head and shoulders in two colours, 4.5:1 or better). The choice shows in the sidebar at once. With no choice, the initials show.
- **RB-PIC-02** **A photo is JPEG, PNG or WebP, at most 5 MB** (GIF, SVG and other files are refused with a sentence). It is cut to the largest centred
  square and shrunk to 256 x 256 (`cropSquare`, `PHOTO_SIZE`) before it is kept, so it fills every round frame without being stretched; the frame uses
  `object-fit: cover`. A transparent PNG gets a white background. The preview keeps the choice per person in this browser
  (`coverlay.preview.avatar.<userId>`); a saved value that is not a JPEG/PNG/WebP data URL or a known avatar id (a web address, an SVG, edited by hand) is
  ignored and the initials show. The real build MUST store the photo with the account, re-check type and size on the server, re-encode it, and never serve
  a person's photo to anyone else.
- **RB-PIC-03** **Import from LinkedIn** is a card on the Resume analyzer (`/upload#linkedin`, the Connected apps LinkedIn row links to it): three steps (save
  your profile to PDF on LinkedIn, choose it here, check the new version), a **Choose LinkedIn PDF** button that takes a PDF only, and a line saying there is no
  sign-in and the PDF does not carry the photo. The PDF goes through the same upload and analysis as any resume (RB-CON-02 still holds: no sign-in, no scraping).
- **RB-PIC-04** **Stage two (planned): Sign in with LinkedIn** to bring the name, email and photo in automatically. It needs a LinkedIn developer app and
  reverses the no-sign-in line of RB-CON-02 for those three fields only (it never reads work history), so it ships only when the owner decides. Until then the
  photo comes from the person saving it on LinkedIn and uploading it (RB-PIC-01), and they can always change it to an avatar or another picture.
- **RB-CON-03** **How Lay AI reaches an outside service is a connector**: a Model Context Protocol (MCP) server that Coverlay runs for a service, and, later,
  one the person adds themselves. This is how Lay AI gets suggestions "across all the domains" without Coverlay copying a portal. The rules for every
  connector (the backend MUST enforce them, the prototype shows the first three):
  1. It is off until the person connects it, and they can turn it off again. Before it is turned on the screen lists its tools and what each one reads.
  2. It is read-only for job and company data (search, details). It never applies, sends or posts; the one exception is Gmail's save-draft and send, which
     are the person's own click (RB-LET-06).
  3. It uses only what a service's terms allow: no scraping of a site that forbids it, no session borrowed from the person's browser.
  4. What it is sent is only what the tool needs (a job title, skills, a city), never the person's name, email, phone or resume text (RB-AI-09).
  5. Whatever it returns is untrusted data, never instructions: markup is stripped, the length is limited, and it cannot change what Lay AI is allowed to do.
  6. A tool call is logged by connector, tool and time, never by its content. Sign-in tokens are encrypted at rest and revoked at the service when the person
     disconnects or deletes their account.
  7. A connector the person adds themselves MUST be checked before use: `https` only, no private or local addresses, a time limit and a size limit on every
     call, and the tool list shown to the person first. (Not in the prototype.)
- **RB-CON-04** **Deleting the account disconnects every app.** The deletion job has its own step, `connections`: "Connected apps: access revoked and sign-in
  tokens deleted", between the search entries and the account rows. The export names the apps that were connected, never their tokens.
- **RB-CON-05** Data: a `connections` table (account id, provider, status, the permissions granted, a reference to the encrypted token, connected and revoked
  times). Connecting Gmail on Settings or on the Letters page is the same row.

### 6.7 What is only a mock-up (RB-PRE)

- **RB-ADM-01** **The admin console is a separate window, not part of the user app.** Administrators get their own shell at a secret address (RB-ADM-02): a black sidebar tagged
  **Admin console** with its own links (**Admin analytics**, **Bug reports**), their own pages, and no Lay AI and no bug-report dialog. The user app's sidebar, pages and
  landing page carry no admin link, section or tag. An administrator who signs in lands in the console (unless they were sent to sign in from another page) and
  reaches the user view with **Open the user view**; a person who is not an administrator has no admin address to type: for them `/admin` or any guess is an unknown address like any other (the backend still
  checks ADMIN on every call, RB-ADM-03). The console's analytics are its own: platform-wide numbers about the whole product, never the person's own analysis (that is
  "Your analysis" in the user app).
- **RB-ADM-02** **The admin console and the admin API are not at `/admin`, and their address cannot be guessed or read out of the app.** The backend holds one secret
  path segment (`APP_ADMIN_PATH`: 24 to 64 letters, digits, `-` or `_`; the backend refuses to start with a shorter one, one that contains "admin", or one that
  is not random; when it is not set a new random one is made at every start). Every admin endpoint lives under it (`/{admin-path}/users`, `/{admin-path}/jobs/...`,
  `/{admin-path}/bug-reports...`, `/{admin-path}/skill-vectors/snapshot`, `/{admin-path}/roles/{id}/skill-vectors/recompute`); nothing is mapped at `/admin`. The
  path is told only to an administrator, about their own account, in the answer to sign-in and to `GET /auth/me` (`adminPath`); for everyone else the field is
  absent. The frontend takes the console's address from that field (`/{admin-path}` and `/{admin-path}/bugs`): the address is not in the bundle, the routes do
  not exist until an administrator is signed in, and a stored value that is not the promised shape is ignored (`admin-rules.js`). The admin endpoints are left out
  of the public API docs.
- **RB-ADM-03** **Knowing the address gives nothing.** The path is one layer, never the access check. (1) Every admin endpoint requires the ADMIN role, checked twice
  (the URL rule and on the endpoint), with the role read from the database on every request, so removing the role works at once. (2) A signed-in person who is
  not an administrator gets, at any address under the admin path, exactly the 404 that an address that does not exist gets (same status, same body); a person
  with no session gets the same 401 every address gives. A correct guess cannot be told from a wrong one. (3) Every admin call, and every refused one, is
  written to the `admin.audit` log: the account, the action, the result and the caller's address, without the secret path and without the query string.
  (4) An administrator cannot change their own access level; another administrator must. **Still to decide (not built):** a second sign-in step for
  administrators, a shorter session for them, and a limit on which networks may reach the admin path.
- **RB-ADM-04** **A person's own analytics stay theirs, in the user app.** My activity (RB-ACT), "Your analysis" and the Applications insights are each person's own numbers, on their own
  pages; they are never part of the admin console, and the console's platform-wide analytics (RB-PRE-01) never show one person's.
- **RB-PRE-01** **Admin analytics (formerly Team insights) is a mock-up and is not part of the product.** The admin page in the preview (the console's first page) shows what an internal
  dashboard could look like, with sample numbers, so the owner can react to it. The frontend and the backend MUST NOT build it as it is, and no requirement here
  depends on it. What the owner's internal dashboard shows is decided later, from how Coverlay is really used. In the preview it carries the tag **Mock-up**
  (not "Preview", which means a screen that will be built).

### 6.8 The wallet history (RB-WAL)

- **RB-WAL-01** **The history folds repeats.** Every entry of the same kind and label on the same calendar day is one row (`Lay AI message × 13`, with the credits
  added up and the time of the latest), newest first, so a busy week of chat is a few rows and not a long list of identical ones. A row of more than one entry says
  how many and how many credits each, as its tooltip. The balance is the sum of every entry, grouped or not. (`groupHistory()` in `wallet-rules.js`.)

### 6.9 Lay AI on every page (RB-LAY)

Lay AI is one assistant that follows the person through the app. The chat is `components/lay-chat.js`, mounted once by `components/shell.js` (`lay-global.js`);
what it can do is in `pages/lay-agent-rules.js` (DOM-free; `tests/lay-agent-rules.test.js`); what it reads from the device and leaves for the next page is
`pages/lay-agent.js`.

- **RB-LAY-01** **Lay AI is on every signed-in page.** The black-square button at the bottom right opens the panel (RB-APP-06) on Overview, Resume analyzer,
  Letters & emails, Role matches, JD match, Jobs, Saved jobs, Applications, Watchlist, Community, Wallet, Settings and the admin pages. The Builder keeps its own
  Lay AI panel (RB-AI-01) and does not get a second one. A page that knows more adds its own answers (`setLayPage`); Lay AI's own work comes first when a message
  asks for it. A phone shows the panel as a bottom sheet and the quick questions as one scrolling row.
- **RB-LAY-02** **The box takes a pasted job description.** It is a text area of up to 6,000 characters: Enter sends, Shift+Enter adds a line, and it grows to
  about six lines and then scrolls. **The conversation follows the person from page to page** on the device: the last 30 messages, as the guard made them
  (placeholders for name, college and contacts; filled in again on the person's own screen), under **New chat**, which clears them. **A long message is kept only
  as its first 300 characters and a word count, and the raw job description is never stored anywhere**: only what was read from it (role, company, skills)
  is kept, for a day, so "match it" can follow "here is the job". Buttons are not restored with an old message: a decision belongs to the moment it was asked.
- **RB-LAY-03** **Lay AI proposes, the person agrees, one action at a time.** Given a request ("I learned Docker and Kubernetes, add them to my resume. Here is the
  JD: ..."), it answers with what it would do in plain lines and buttons: **Yes, open the Builder** / **Not now**. Nothing is changed, saved or sent before the
  press, and a press settles that message (its buttons are disabled afterwards). The requests it understands: add skills the person says they have; tailor the
  resume to a job description; match the resume to a job; draft a cold email; say where the rejections are (RB-APP-13); open a page of this app by name. A pasted job
  description on its own is read back (role, company, skills it asks for) with **Tailor my resume**, **Match my resume** and **Draft a cold email**. A message it
  cannot place gets help that gives examples, or the page's own answer.
- **RB-LAY-04** **It only says what is true.** (1) It adds only skills the person's own message names as theirs: never one that is only in the job description;
  the skills the job asks for and the resume lacks are listed ("I won't add them unless you tell me you have them"). (2) It never writes or changes Experience,
  Education, name or contact details. (3) A tailored Summary is built from skills the resume listed *before* this update, never from one the person has just
  added, so it does not claim experience they only now say they have; a fact the person wrote (the first sentence with a number) stays. (4) The match counts
  skills by name, from Skills and from what the Summary and Experience say, and says what it counted and that the real one reads meaning too. (5) A remembered job
  description is used for an update only when the message points at it ("for this job", "tailor it"), so "add Docker to my skills" never turns into a tailoring.
- **RB-LAY-05** **Redirect to the Builder, then do it.** On any page other than the Builder the first yes saves the request (the skills and the job's role, company
  and skills; nothing else) as a *handoff* on the device, says "Opening the Builder", and opens it. The Builder takes the handoff once (it is valid for two hours,
  is removed when taken, and is ignored if it is not one of ours), reopens a finished resume if needed, and carries it out as **one new version** named
  "Lay AI: added Docker, Kubernetes; tailored for Platform Engineer (you agreed)": the skills the job asks for first, the Summary for its role, what changed in
  green with the Lay AI cursor on it, Versions able to take it back, and the Lay AI panel open on the answer. With no resume yet the request waits (the start
  page says so) and is carried out when the first resume exists. On the Builder itself the same request asks for one yes in the panel and does it there.
- **RB-LAY-06** **The next steps are offered, not taken.** After the update: **Match it to the job** (with the percentage, what is covered, what is not, what is only
  in the experience text, the nice-to-haves) and then **Draft a cold email**. The email is the Letters draft for that job (RB-LET-01: the "Hiring manager"
  template, placeholders for anything personal, filled in on the person's own screen) shown in the chat as a quoted block with its subject.
- **RB-LAY-07** **A cold email is prepared in the chat and sent only by the person, on the Letters page.** The buttons are **Open in Letters to send** (the job and
  nothing else go to Letters as a handoff; Letters opens on Cold email with the draft, a note that Lay AI prepared it and that nothing has been sent, and the person
  adds the address and presses Send, then confirms, RB-LET-06), **Save as a Gmail draft** when Gmail is connected (a draft, with the resume and the cover letter
  attached, and no recipient; nothing is sent) or **Connect Gmail first** (Settings) when it is not. **No Lay AI button sends mail.** This is deliberate: a send is
  the one action that cannot be undone, so it stays behind the person's own address, their own Send and the second confirmation, even for a person who trusts
  Lay AI. If the draft still has a blank ("[Company]" when the job description did not name the company; "{user.link}" when the resume has no link) Lay AI says
  which; **a draft may keep a blank, a send may not** (`buildMailRequest` refuses to send one, in the prototype and in the backend).
- **RB-LAY-08** **The same rules everywhere.** The rules are one module used by the global chat and the Builder's panel; messages in the Builder's panel keep their
  buttons (`kind: agent`) and keep only placeholders; a card is filled in for display only. Every opening answer is plain, has no exclamation marks and no button
  that sends. In the real build the model proposes with the same constraints (RB-AI, ML-01 to ML-07) and the backend repeats them: a step that changes a resume is
  one version written by `POST /api/builder/documents/{id}/versions` with `source: ai`; a connector tool call follows RB-CON-03; and Lay AI's own requests are
  logged by kind and time, never by content.

## 7. What the frontend MUST do

- **FE-01** Implement sections 2 to 6 exactly. The rules in `resume-builder-rules.js`, `resume-doc.js`, `resume-ruler.js`
  and `privacy-guard-rules.js` are the reference implementation; port them, do not reinterpret them. Their functions
  have no browser in them so they can be moved as they are.
- **FE-02** Anything that comes from a service (resume text, suggestions, section titles, table cells) is written with
  `textContent` or the editor's schema, never as HTML (RB-DATA-03, RB-DATA-04).
- **FE-03** Keep the editor behind the converter: the rest of the app sees plain resume objects, never editor internals,
  so versions, diffs, Lay AI and the backend never depend on the editor.
- **FE-04** **The frontend is React and TypeScript on Vite** (decided 8 Nov 2026, when the application grew past what hand-written pages could carry): React 19, React
  Router, SWR for what the backend answers, Tiptap for the two document editors. The look is unchanged: the same stylesheet and class names (`frontend/src/css/app.css`).
  The rules modules stay plain JavaScript with no React and no DOM, so Node tests them (`npm test`) and the backend and ML contract tests copy their fixtures;
  the screens only draw what the rules decide. A change MUST pass `npm test`, `npm run typecheck` and `npm run build` (the CI job runs all three).
  The earlier text of this requirement follows and still holds: any build step MUST still pass every test
  in `frontend/tests`.
- **FE-05** **The routes.** `/` (landing), `/login`, `/register`, then, for a signed-in person only: `/dashboard` (tabs by hash: `#overview`, `#matches`, `#jd`), `/upload`,
  `/builder`, `/letters`, `/jobs`, `/saved`, `/applications`, `/watchlist`, `/community`, `/activity` (My activity, RB-ACT), `/wallet`, `/settings`, and, for administrators only and in their own shell (RB-ADM-01), `/{admin-path}` (admin analytics, preview only) and `/{admin-path}/bugs`, where the path is the secret one the backend gives an administrator (RB-ADM-02); there is no `/admin` route. A person with no session is sent to `/login`
  and back to where they were going after signing in; a 401 from the backend ends the session and does the same. An address from the older app (`/dashboard.html`,
  `/resume-builder.html`) goes to its route. `/preview` (the hub that signs in a sample person and links every screen), `/signup-preview` and the admin analytics page (RB-PRE-01) exist **only in a preview build** (`npm run dev`, or `VITE_PREVIEW=true npm run build`): a production build does not contain them.
- **FE-06** **Where the app finds its backend.** `index.html` loads `/config.js` before the app, which sets `window.__COVERLAY__.apiBaseUrl`; nginx writes it at start-up
  (`API_BASE_URL`, `/api` behind the proxy) and `npm run dev` serves one that points at the sample API. `BACKEND_URL=http://localhost:8080 npm run dev` sends `/api` to the real
  backend instead. Every call goes through `app/lib/http.ts` (the session's JWT, `ApiError`, the 401 rule).
- **FE-07** **Speed.** Written to the Vercel React best-practices rules (installed at `.agents/skills/vercel-react-best-practices`): every screen is its own chunk, loaded when it is first
  visited, and Lay AI's chat is its own chunk fetched after the shell is drawn (the Builder and Letters, with their editors, are the only pages that download Tiptap); no barrel files; what
  the backend answers is read with SWR, so a request shared by the sidebar, the version menu and a page is made once; list items that do not change are `memo`; stored state is read once, lazily,
  and written when it changes; effects depend on the values they use and nothing more; and browser listeners are added once and removed with the component.

## 8. Not in the prototype yet (so not yet required)

These are known gaps. Each is to be added to the prototype and to this document before it is built.
Until then no service may ship a version of them that the prototype does not show.

- Real Lay AI answers (the prototype uses canned replies), including answers about custom sections and tables.
- The real PDF build (typeset on the server, and Classic's LaTeX look), and DOCX and PDF produced on the server.
- Sending through Outlook and other mail services, and any real Gmail call (section 6.5).
- Any real connector (MCP) for a job search service, and the person's own connector (section 6.6).
- Importing an uploaded resume into the builder from the real parsed profile.
- True pagination (text flowing onto a second page with margins); dragging table column widths.
- Several documents per account and sharing a document.

## 9. Contracts for the services

### 9.1 Backend

The paths below are recommended (SHOULD); the **shapes, validation, limits and behaviour are mandatory (MUST)**.

| Purpose | Request | Response |
|---|---|---|
| Start | `POST /api/builder/documents` `{answers, templateId, fromUploadId?}` | the document: `{id, answers, templateId, format, versions:[v1], current:1}` |
| Read | `GET /api/builder/documents/{id}` | the document |
| List | `GET /api/builder/documents` | the person's documents, newest first |
| Format | `PUT /api/builder/documents/{id}/format` `{format}` | the normalised format (RB-FMT-01) |
| Template | `PUT /api/builder/documents/{id}/template` `{templateId}` | the document, with the new version (RB-VER-03) and the template's format (RB-FMT-05) |
| Write a version | `POST /api/builder/documents/{id}/versions` `{baseVersion, resume, source, summary}` | the new version; `409` if `baseVersion` is not current |
| Restore | `POST /api/builder/documents/{id}/versions/{n}/restore` | the new `restore` version |
| Export | `GET /api/builder/documents/{id}/export?format=pdf\|docx&version={n}` | the file (RB-EXP) |
| Reading order | `GET /api/builder/documents/{id}/reading-order?version={n}` | `{text, notes}` (RB-ATS) |
| Letter or email text | `PUT /api/letters/{id}` `{subject?, blocks:[markup]}` | the stored text; `422` unless it follows RB-LET-09: at most 60 blocks of at most 4,000 characters, a one-line subject of at most 200, markup as in RB-DATA-03 and RB-DATA-04 with any colour dropped, and the personal-data guard run over the whole text |
| Cover letter file | `GET /api/letters/{id}/export?format=pdf\|docx` | the file (RB-LET-03) |
| Connected apps | `GET /api/connections` | `[{provider, connected, connectedAt}]` for every service that can be connected (RB-CON-02) |
| Disconnect an app | `DELETE /api/connections/{provider}` | `204`; the access is revoked at the service and the tokens deleted (RB-CON-03, RB-CON-04) |
| Application note | `PUT /api/applications/{id}/notes` `{notes}` | the note, cleaned as RB-APP-11 (line breaks, one blank line, at most 2,000 characters); an empty note removes it; `404` for another person's application; never part of an outcome record (RB-APP-12) |
| Lay AI: propose | `POST /api/lay/requests` `{text}` (guarded text only) | `{reply, actions:[{id,label,primary}], payload, card?}` as RB-LAY-03 to RB-LAY-06; changes nothing |
| Lay AI: a step | `POST /api/lay/requests/{id}/steps/{actionId}` | `{reply, actions?, card?}` and, for `update`, the new version of the resume (RB-LAY-05); `email-draft` saves a Gmail draft and `email-letters` returns the job for Letters; there is no send step (RB-LAY-07) |
| Lay AI: history | `GET /api/lay/messages` and `DELETE /api/lay/messages` | the last 30 messages as the guard stored them (RB-LAY-02); the delete is "New chat" |
| Gmail: connect | `POST /api/mail/gmail/connect` then the OAuth callback `GET /api/mail/gmail/callback` | the Google consent address; then `{connected, account}` (RB-LET-07) |
| Gmail: status | `GET /api/mail/gmail` | `{connected, account}` |
| Gmail: disconnect | `DELETE /api/mail/gmail` | `204`; tokens removed and revoked |
| Gmail: save draft or send | `POST /api/mail/gmail/drafts` or `POST /api/mail/gmail/send` `{letterId, to?, subject, attachments:[{kind, format}]}` | `{messageId}`; `422` with the reason for any failed check of RB-LET-04; `429` over the daily limit (RB-LET-06) |
| Chat | `POST /api/builder/documents/{id}/chat` `{message}` | a streamed Lay AI message (RB-AI-07) |
| Suggestion | `POST /api/builder/documents/{id}/chat/{messageId}/items/{itemId}` `{action:"add"\|"skip"}` | the new version when added, else `204` |
| Delete | `DELETE /api/builder/documents/{id}` | `204`; versions and chats go with it (the data-model decisions govern what is kept) |

- **BE-01** Validate everything on every write: the resume against section 2.1 and 2.2, the format against 2.3,
  `source` against RB-VER-01, links against RB-DATA-04. Reject what cannot be repaired with `400` and a message the
  person can read; repair the rest the way the prototype does. Never store markup outside RB-DATA-03.
- **BE-02** Enforce the limits: 50 versions per document (RB-VER-06), a title of 1 to 80 characters, and a maximum size
  for a resume (SHOULD be 200 KB) and for a chat message (SHOULD be 2,000 characters). Return `413` or `400`, never
  truncate silently.
- **BE-03** Versions are append-only (RB-VER-07). A restore never rewrites history. The server sets `at`; it never
  trusts the client's clock.
- **BE-04** A person can reach only their own documents. Every endpoint checks the owner; an id that is not theirs
  is `404`.
- **BE-05** The personal-data guard runs **before** anything is stored, logged or sent to the ML service (RB-AI-09).
  Chat records hold placeholders; the vault of real values is the account's own.
- **BE-06** Accepting a suggestion is a write by the server on the person's behalf: it applies exactly the item that was
  offered (the same `applySuggestion` result) and records `source: "ai"` with the summaries of RB-VER-04.
- **BE-07** Export renders from a stored version and the document's format with the same rules as the page (RB-EXP-02),
  and produces the reading order of RB-ATS-01 from the same function as the reading-order endpoint.
- **BE-08** Log a request id on every call (as the rest of the backend does) and never log resume text or chat text.

### 9.2 ML service

- **ML-01** Lay AI's text comes from the language model; **layout never does.** Fit-to-page, margins, columns, zoom and the
  tips of RB-AI-10 are not model calls and MUST NOT be.
- **ML-02** The resume and the chat message are **data, never instructions** (the hidden-text and prompt-injection
  guardrails). A resume that says "ignore the above" changes nothing.
- **ML-03** Lay AI follows `design/lay-ai/style-guide.md`: a chat answer is at most 80 words, plain words, suggests rather than
  writes, uses placeholders only, is honest about gaps, and asks at most one question. Its output is checked against
  `design/lay-ai/examples.json` in CI.
- **ML-04** The reply is the JSON of RB-AI-07, validated before it is returned. A skill the resume does not support
  MUST carry the evidence text of RB-AI-04; a summary rewrite MUST use only facts already in the resume. An item that
  fails validation is dropped, not repaired by guessing.
- **ML-05** The writing style (`formal`, `concise`, `friendly`, `beginner`) changes the wording of what Lay AI writes into the
  resume, never these rules.
- **ML-06** Model choice follows the tiers already in the service (extract, chat, write); every call is tagged with the
  feature, the user type and the subject id for cost reporting, and the cost per analysis is checked with
  `ml-service/scripts/llm_cost_check.py` (dry run, then real) before any wider rollout.
- **ML-07** When the model cannot answer, Lay AI says so in one plain sentence and the person's resume is untouched.
  A failed call never loses a version.

## 10. Requirement index

| Area | IDs | Pinned by |
|---|---|---|
| Data and formatting | RB-DATA, RB-FMT | `resume-builder-rules.test.js` (`normalizeFormat`, `safeHref`, rich text, margins, lengths), `resume-doc.test.js` |
| Versions | RB-VER | `resume-builder-rules.test.js` (history, restore) |
| Templates | RB-TPL | `resume-builder-rules.test.js` (`suggestTemplates`, catalogue) |
| Editor, sections, tables | RB-EDIT, RB-SEC, RB-BLOCK | `resume-doc.test.js` (converter, tables, defaults, paths) and the walk-through |
| Page, rulers, fit | RB-PAGE, RB-FIT | `resume-builder-rules.test.js` (`fitToPages`, `pageUsage`, margins), `resume-ruler.test.js` |
| Reading order | RB-ATS | `resume-doc.test.js` (`docToPlainText`, `readingNotes`) |
| Lay AI | RB-AI | `resume-builder-rules.test.js` (sample replies, suggestions, `watchHint`), `privacy-guard-rules.test.js`; cursor and scroll by the walk-through |
| Screen | RB-UI, RB-EXP | the walk-through |
| Community | RB-COM | `community-rules.test.js` (anonymous posts, no linking fields, the device-only "You", the old-save conversion, the identity check, votes, comment branches, views), and the walk-through |
| My activity | RB-ACT | `activity-rules.test.js` (skills and education and their source, skills to add, applications sent, postings opened, saved jobs, the device-only community counts and lists), and the walk-through |
| Applications board and its Lay AI | RB-APP | `applications-rules.test.js` (moves, reminders, `findApplication`, `layApplicationsReply`, notes, `rejectionsSummary`, the outcome record), and the walk-through |
| Lay AI on every page | RB-LAY | `lay-agent-rules.test.js` (the job description, the request, the plan and what it will not add, the match, the email, the handoffs, the history), `mail-rules.test.js` (blanks), and the walk-through |
| Letters, emails, Word files | RB-LET, RB-EXP-04 | `letters-rules.test.js` (length, greeting, suggestions), `letter-doc.test.js` (blocks, the guard, formatting, suggestions in edited text), `mail-rules.test.js` (every check of RB-LET-04), `letter-docx.test.js`, `docx-writer.test.js`, `resume-docx.test.js` (the files, read back) and the walk-through |
| Connected apps, mock-ups, wallet history | RB-CON, RB-PRE, RB-WAL | `connections-rules.test.js` (the catalogue, what can be switched on, the stored state), `settings-rules.test.js` (the deletion step), `wallet-rules.test.js` (`groupHistory`) and the walk-through |
| Services | BE, ML | contract tests, section 11 |

## 11. How it is checked

**Executable.** `cd frontend && npm test` runs every rule above that has no browser in it. The backend and the ML service MUST add
**contract tests** that load the same fixtures and expect the same results: the sample resume, the format normalisation cases,
the fit cases (including the 20-measurement bound), the reading-order text, the table and block validation cases (including a
`javascript:` link and a nested table, which must be rejected), and the suggestion JSON shape. A fixture is copied from the
prototype's test, never rewritten.

**Walk-through.** A person can run `cd frontend && npm run preview` and must be able to do all of this in the real application:

1. Pick a template (including a two-column one), type in every field, make text bold and add a link, and see one version per field.
2. Drag a margin on the ruler, set margins in Page setup in centimetres and then inches, and see the page count change.
3. Add a table section (its lines are visible), type Technical and Soft skills side by side, set the line width to 0 to hide the lines (the table stays) and back to 1, try the dashed and dotted lines, change the padding and the gap, and hide the built-in Skills.
4. Open "How an ATS reads this" and read the table as plain text.
5. Make the resume too long, press Fit to page, then ask Lay AI to fit it on one page; with far too much text, see it stop at 9.5 pt and say so, deleting nothing.
6. Ask Lay AI to add a skill that is below the fold and watch the page scroll to it.
7. Resize the Lay AI panel; zoom to 150%; switch to a phone width.
8. View an old version, restore it, and download the PDF.
9. On Jobs (not the Builder), open Lay AI, type "I learned Docker and Kubernetes, add them to my resume. Here is the JD:" and paste a job description under it: Lay AI lists what it will change and what it won't add, and changes nothing yet. Press **Yes, open the Builder**: the Builder opens, the change is one new version in green, and the panel is open on the answer. Press **Match it to the job**, then **Draft a cold email**, then **Open in Letters to send**: Letters opens on Cold email with the draft and a note, and Send refuses while a blank is left.
10. On Applications, press **+ Notes** on a card, type, press **Move to…** on another card (the note stays open and kept), and ask Lay AI "Where are my rejections?".
9. On the Applications board, drag a card onto another column, check its date and reminder changed, drop it on its own column and see nothing change, then ask Lay AI "What's due?", "Status of Swiggy" and "Move Razorpay to Applied" and see the card come into view and only move when you press Move it.
10. On the Community page, post, and see that every post says "Anonymous", that only your own posts carry "You" on your screen, and that the side card is yours alone.
11. Open the version menu on the dashboard with many uploaded versions and see that it scrolls and the sidebar stays short, with Report a bug and Sign out always at the bottom.

A feature is not done until it passes the tests and the walk-through, and this document says the same thing the prototype does.
