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

The other prototype pages (Letters, Wallet, Settings, Team insights,
the Lay AI agent) follow the same rule: the prototype is the source of truth for them too. Their
behaviour lives in their `*-rules.js` files and tests. This document specifies the Resume Builder in
full because it is the largest piece, the Applications board in section 6.3 and the Community in section 6.4; each of the others is to get a
section here before its backend is built.

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
- **RB-DATA-03** Rich text is a string using only `<b>`, `<i>`, `<u>` and `<a href="…">`, with `&`,
  `<` and `>` in the text escaped as `&amp;`, `&lt;`, `&gt;`. Nothing else is stored. The
  canonical nesting order is `<a><u><b><i>text</i></b></u></a>`; two spellings of the same
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
| table | `{type:"table", attrs:{borders:"none"\|"rows"\|"light"\|"all"}, content:[tableRow…]}` |
| table row | `{type:"tableRow", content:[tableHeader\|tableCell…]}` |
| table cell | `{type:"tableHeader"\|"tableCell", attrs:{colspan, rowspan, colwidth}, content:[paragraph\|bulletList…]}` |
| inline text | `{type:"text", text, marks?:[{type:"bold"}\|{type:"italic"}\|{type:"underline"}\|{type:"link", attrs:{href}}]}` |

- **RB-BLOCK-01** The backend MUST validate `extra` against exactly this list and reject (or strip)
  any other node type, mark, or attribute, and apply RB-DATA-04 to every `href`. Cells MUST NOT
  contain tables (no nesting). A section MUST have a non-empty title of at most 80 characters.
- **RB-BLOCK-02** A cell attribute that is only a default (`colspan` 1, `rowspan` 1,
  `colwidth` null) MUST NOT make two tables compare different.
- **RB-BLOCK-03** A new table section has 2 to 4 columns, a header row (`Technical skills`,
  `Soft skills`, `Tools`, `Languages` in that order), one body row of empty bullet lists, and
  `borders: "none"`. This is the "table with the borders set to none" people build in Word for
  side-by-side lists, and it is a first-class feature.
- **RB-BLOCK-04** `borders` means: `none` draws nothing; `rows` draws a line under each row;
  `light` a thin grey grid; `all` a full black grid. While **editing**, a `none` table shows faint
  dotted guides so the cells can be found; the guides MUST NOT appear in the finished resume, in
  an old version view, in print, or in an export.
- **RB-BLOCK-05** Custom sections come after the built-in ones in one-column layout, and after
  Experience in the main column in two-column layout. They can be moved up or down past each
  other and deleted.

### 2.3 The format (RB-FMT)

The format is how the resume is **set on the page**. It belongs to the document, is saved with it,
and is **not versioned**: changing the font size does not create a version.

| Key | Values | Default |
|---|---|---|
| `font` | `sans`, `serif`, `classic` (CMU Serif, the LaTeX look) | `sans` |
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
- **RB-EDIT-03** Bold, italic, underline and link work from the toolbar, from Ctrl+B, Ctrl+I and
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
  a column or row, merge cells, split a cell, header row on or off, the borders menu (RB-BLOCK-04),
  and Delete table. A tool that cannot apply is disabled.
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
  borders and solid versus outlined badges. The resume itself is white paper; a template may colour its own
  headings.
- **RB-UI-02** The toolbar has two rows with every control the same height and centred on the row: row one for
  text (undo and redo; font and size; bold, italic, underline, link; bullets, header alignment, spacing), row two
  for the page and content (add section; columns, page limit, Page setup, Fit to page; writing style at the
  right). The section and table tools sit in a bar of the same kind below it.
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
  Motion is limited to the Lay AI button's float and the cursor's move, and stops for reduced motion.

### 6.2 Export (RB-EXP)

- **RB-EXP-01** The finished resume shows **Download PDF** (the prototype uses the browser's print to PDF with the
  paper size set to the format's page and zero page margin, so the format's margins are the page margins) and
  **Download DOCX**. Classic is PDF only.
- **RB-EXP-02** The real PDF and DOCX MUST reproduce the page: paper size, the four margins, columns, font and size,
  spacing, bold, italic, underline, links, bullets, tables with their borders (none, rows, light, all), hidden
  sections left out, section lines on or off. The PDF MUST have a text layer in the reading order of RB-ATS-01 and
  MUST NOT put contact details in a page header or footer. A two-column DOCX MUST use real section columns, not text
  boxes. A `none` table MUST be a real table with its borders set to none, so it stays editable in Word.
- **RB-EXP-03** Fonts: `sans` and `serif` are the system sans and Georgia; `classic` is CMU Serif (Typst with New Computer
  Modern for the PDF). The exported file embeds its fonts.

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
- DOCX export, and the real PDF build.
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
| Community | RB-COM | `community-rules.test.js` (anonymous posts, no linking fields, the device-only "You", the old-save conversion, the identity check), and the walk-through |
| Applications board and its Lay AI | RB-APP | `applications-rules.test.js` (moves, reminders, `findApplication`, `layApplicationsReply`), and the walk-through |
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
3. Add a table section with the borders hidden, type Technical and Soft skills side by side, switch the borders on and off, and hide the built-in Skills.
4. Open "How an ATS reads this" and read the table as plain text.
5. Make the resume too long, press Fit to page, then ask Lay AI to fit it on one page; with far too much text, see it stop at 9.5 pt and say so, deleting nothing.
6. Ask Lay AI to add a skill that is below the fold and watch the page scroll to it.
7. Resize the Lay AI panel; zoom to 150%; switch to a phone width.
8. View an old version, restore it, and download the PDF.
9. On the Applications board, drag a card onto another column, check its date and reminder changed, drop it on its own column and see nothing change, then ask Lay AI "What's due?", "Status of Swiggy" and "Move Razorpay to Applied" and see the card come into view and only move when you press Move it.
10. On the Community page, post, and see that every post says "Anonymous", that only your own posts carry "You" on your screen, and that the side card is yours alone.
11. Open the version menu on the dashboard with many uploaded versions and see that it scrolls and the sidebar stays short, with Report a bug and Sign out always at the bottom.

A feature is not done until it passes the tests and the walk-through, and this document says the same thing the prototype does.
