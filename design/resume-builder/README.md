# Resume Builder: design

A planned feature: a page where the resume is shown on the left and can be edited by typing,
with Lay AI (the assistant) in a right-side panel -- Chat and Versions tabs -- that changes the
same resume. The full plan is on the "Roadmap" tab of the Project Tracker sheet.

To look at it: open `wireframe-v2.png`. To edit it by hand: open `wireframe-v2.excalidraw` at
excalidraw.com (menu -> Open). `wireframe.json` is the source of the wireframe. It is a list of Excalidraw elements in the
simplified format of the Excalidraw drawing tool Claude uses (shapes with a `label`,
`cameraUpdate` steps), so it can be re-rendered and changed in a later session. To change the
wireframe, edit this file and render it again; git history keeps every version.

## Versions

| Version | What it shows |
|---|---|
| v1 | The two-pane page: resume preview with editable (dashed) fields on the left, AI chat on the right, and green highlights for what the AI just changed. |
| owner's sketch | `owner-sketch-v2.webp`: the owner's notes on v1 -- the chat starts closed behind a floating AI button, and an extra "AI pointer" follows the user's edits. |
| v2 | `wireframe.json` now: the complete flow in 7 screens -- start questions, templates from the answers, editor with the panel closed (floating Lay AI button), Chat tab, Versions tab, the Lay AI pointer (animation only, no AI call), finished resume -- plus notes and a legend. v1 is in git history. |
