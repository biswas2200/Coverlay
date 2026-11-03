# Resume Builder: design

A planned feature: a page where the resume is shown on the left and can be edited by typing,
with a chat on the right that asks the AI to change it. Both edit the same resume.

`wireframe.json` is the source of the wireframe. It is a list of Excalidraw elements in the
simplified format of the Excalidraw drawing tool Claude uses (shapes with a `label`,
`cameraUpdate` steps), so it can be re-rendered and changed in a later session. To change the
wireframe, edit this file and render it again; git history keeps every version.

## Versions

| Version | What it shows |
|---|---|
| v1 | The two-pane page: resume preview with editable (dashed) fields on the left, AI chat on the right, and green highlights for what the AI just changed. |
| v2 (owner's sketch) | `owner-sketch-v2.webp`: the owner's notes on v1 -- the chat starts closed behind a floating "Coverlay AI" button, and an extra "AI pointer" follows the user's edits. Not yet turned into `wireframe.json`. |
