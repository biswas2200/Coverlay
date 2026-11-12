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
| Run it | `cd frontend && npm run preview`, then open the hub and choose Resume Builder |

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

- **RB-UI-01** One theme: a white page, black text and borders, greys for fills, **Fira Mono** for every character
  of the interface. No dark mode, and no colour for meaning (no green or red): status is carried by words,
  borders and solid versus outlined badges. The exceptions are **Sign out**, which turns red (`#b3261e` on a
  pale red fill) when pointed at or focused because it ends the session, and the swatches of the text colour
  palette (RB-FMT-06), which are the choices themselves. The documents the person makes are not interface: the
  resume paper, the letters and the analyzer's view of the resume use the document fonts of RB-EXP-03, not Fira
  Mono (a monospace body does not read as a resume). The resume is white paper; a template may colour its own headings.
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
  (the only part that scrolls, with the admin links at its end for administrators), and **Report a bug** and
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
  "Summarise my board", "Status of Swiggy", "Move Razorpay to Applied") and a box. The same component is to be used on any
  page that gets Lay AI.
- **RB-APP-07** Lay AI answers from the person's own board: what is due in the next two days; which applications sent a week
  or more ago have had no news; a summary (count per column and the one that needs the person most); the status of one
  application found by company first and then role words; what to do to prepare for an interview.
- **RB-APP-08** **Lay AI only proposes a move.** For "move Razorpay to Applied", "I got an offer from Zerodha" or "Freshworks
  rejected me" it asks first and shows **Move it** and **Not now**; the board changes only when the person presses Move
  it. A card already in that column is reported, not moved; a message that names no application asks which one.
- **RB-APP-09** When an answer is about a card, that card is scrolled into view and outlined, as in RB-AI-11.
- **RB-APP-10** Replies are at most 80 words, plain, and have no exclamation marks; when Lay AI cannot find what was asked it
  says so and says how to ask, and it never invents an application. In the prototype the chat is not stored and nothing is
  sent anywhere; in the real build it follows RB-AI-09 and ML-01 to ML-07: the board is data, placeholders replace personal
  values, and moving a card is always the person's action.

### 6.4 The community (RB-COM)

The Community page (`frontend/src/community.html`, rules in `community-rules.js`, tests in
`community-rules.test.js`) is a feed of anonymous posts by topic (Interview experience, Salary & offers, Referrals,
Company culture, Career advice).

- **RB-COM-01** **Every post is shown as "Anonymous".** There is no handle, nickname, pseudonym, "mask", colour, avatar,
  initials or any other mark that differs between writers, so nobody can tell that two posts came from the same
  person. All posts sit under the same umbrella. The author line, the composer and the button all say "Anonymous".
- **RB-COM-02** A post stores only its topic, its optional company (up to 60 characters), its text (20 to 1,000
  characters), the **hour** it was made (never the exact time) and its usefulness count. It MUST NOT store, log, index or
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

- **RB-PRE-01** **Team insights is a mock-up and is not part of the product.** The admin page in the preview (`admin-insights.html`) shows what an internal
  dashboard could look like, with sample numbers, so the owner can react to it. The frontend and the backend MUST NOT build it as it is, and no requirement here
  depends on it. What the owner's internal dashboard shows is decided later, from how Coverlay is really used. In the preview it carries the tag **Mock-up**
  (not "Preview", which means a screen that will be built).

### 6.8 The wallet history (RB-WAL)

- **RB-WAL-01** **The history folds repeats.** Every entry of the same kind and label on the same calendar day is one row (`Lay AI message × 13`, with the credits
  added up and the time of the latest), newest first, so a busy week of chat is a few rows and not a long list of identical ones. A row of more than one entry says
  how many and how many credits each, as its tooltip. The balance is the sum of every entry, grouped or not. (`groupHistory()` in `wallet-rules.js`.)

## 7. What the frontend MUST do

- **FE-01** Implement sections 2 to 6 exactly. The rules in `resume-builder-rules.js`, `resume-doc.js`, `resume-ruler.js`
  and `privacy-guard-rules.js` are the reference implementation; port them, do not reinterpret them. Their functions
  have no browser in them so they can be moved as they are.
- **FE-02** Anything that comes from a service (resume text, suggestions, section titles, table cells) is written with
  `textContent` or the editor's schema, never as HTML (RB-DATA-03, RB-DATA-04).
- **FE-03** Keep the editor behind the converter: the rest of the app sees plain resume objects, never editor internals,
  so versions, diffs, Lay AI and the backend never depend on the editor.
- **FE-04** The prototype has no build step for the app. If the real frontend adds one it MUST still pass every test
  in `frontend/tests`.

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

**Built so far** (`backend/src/main/java/com/resumeanalyser/builder`, migration `V12__resume_builder.sql`, which leaves V11 free for
the accounts migration of the data model): the rows Start, Read, List, Format, Template, Write a version, Restore, Reading order
and Delete, with BE-01 to BE-04. **Not yet:** Export, Chat and Suggestion (they need the renderers and the ML service), and
`fromUploadId`, which is answered `400` until an upload's profile can be turned into a resume. Where this section was silent, the
backend does this, and the prototype or this section changes with it if that is wrong:

- A new document starts from the prototype's sample resume (Jane Doe), as the prototype does. It also carries a `title`: the target
  role, or `My resume`. A list row is `{id, title, templateId, current, updatedAt}`; `at` and `updatedAt` are milliseconds since 1970.
- A resume with a field missing or of the wrong type (including a job without `details`) is `400` and the message names the field;
  keys that are not in the model are dropped. In a custom section, a node type outside section 2.2 and a table inside a cell are
  `400`; a mark or attribute that is not on the list is stripped; a link outside RB-DATA-04 or a colour that cannot be read on
  white loses the mark and keeps its text. A title that is empty or over 80 characters is `400`.
- `baseVersion` is required (`400` without it); one that is not the current version is `409`, and so are two writes that raced on
  the same document. A version `summary` is 1 to 200 characters (`400`, never cut). The client sends no time and no number.
- Choosing the template a document already has changes nothing and adds no version. Restoring the current version adds none either
  (as in the prototype); restoring a version that is gone, whether it never existed or the 50-version cap dropped it, is `404`.
- A resume over 200 KB (`MAX_BYTES`, measured in bytes of JSON) is `413`.
- Reading order: `?version=` is optional and defaults to the current version; a version that is gone is `404`. The resume is the
  version's, but the layout choices that change what a parser meets (columns, bullets, hidden sections) are the document's format
  **now**, because the format is not versioned. The response is `{text, notes}`, and `text` comes from `ReadingOrder`, the one
  function export will use for the PDF's text layer (BE-07, RB-EXP-02). It is a contract test: `ReadingOrderTest` loads
  `backend/src/test/resources/contract/reading-order.json`, which the prototype writes by running its own `docToPlainText` and
  `readingNotes` (`node frontend/tests/contract/export-reading-order.mjs`); change the prototype, regenerate, and the test shows
  what the backend must now do. A table section with an empty first row adds no line, and a section with two tables gets one note.
- The start answers (RB-TPL-01) are made valid like the format: a choice outside its list is the default, a role over 80
  characters is `400`.

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
| Reading order | RB-ATS | `resume-doc.test.js` (`docToPlainText`, `readingNotes`); backend: `ReadingOrderTest` on `contract/reading-order.json`, generated by the prototype |
| Lay AI | RB-AI | `resume-builder-rules.test.js` (sample replies, suggestions, `watchHint`), `privacy-guard-rules.test.js`; cursor and scroll by the walk-through |
| Screen | RB-UI, RB-EXP | the walk-through |
| Community | RB-COM | `community-rules.test.js` (anonymous posts, no linking fields, the device-only "You", the old-save conversion, the identity check), and the walk-through |
| Applications board and its Lay AI | RB-APP | `applications-rules.test.js` (moves, reminders, `findApplication`, `layApplicationsReply`), and the walk-through |
| Letters, emails, Word files | RB-LET, RB-EXP-04 | `letters-rules.test.js` (length, greeting, suggestions), `letter-doc.test.js` (blocks, the guard, formatting, suggestions in edited text), `mail-rules.test.js` (every check of RB-LET-04), `letter-docx.test.js`, `docx-writer.test.js`, `resume-docx.test.js` (the files, read back) and the walk-through |
| Connected apps, mock-ups, wallet history | RB-CON, RB-PRE, RB-WAL | `connections-rules.test.js` (the catalogue, what can be switched on, the stored state), `settings-rules.test.js` (the deletion step), `wallet-rules.test.js` (`groupHistory`) and the walk-through |
| Services | BE, ML | contract tests, section 11. Backend: `backend/src/test/java/com/resumeanalyser/builder/*Test.java`; `BuilderPostgresTest` checks the migration, constraints, cascade and lock on a real PostgreSQL and runs when `BUILDER_TEST_DB_URL` is set |

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
9. On the Applications board, drag a card onto another column, check its date and reminder changed, drop it on its own column and see nothing change, then ask Lay AI "What's due?", "Status of Swiggy" and "Move Razorpay to Applied" and see the card come into view and only move when you press Move it.
10. On the Community page, post, and see that every post says "Anonymous", that only your own posts carry "You" on your screen, and that the side card is yours alone.
11. Open the version menu on the dashboard with many uploaded versions and see that it scrolls and the sidebar stays short, with Report a bug and Sign out always at the bottom.

A feature is not done until it passes the tests and the walk-through, and this document says the same thing the prototype does.
