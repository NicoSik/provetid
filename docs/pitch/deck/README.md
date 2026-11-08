# Pitch deck and script: copy in git

These files are a copy of the two claude.ai artifacts that the pitch uses. The artifacts stay the
working version. If you change an artifact, copy it here again.

| Files | Artifact | Version |
|---|---|---|
| `deck.json`, `slides/`, `assets/` | «Prøvetid pitch» (https://claude.ai/artifact/Ton2SKbG6LHim2jgwjy64z) | `1794136129-a63f` |
| `../manus.html` | «Prøvetid manus» | `1794137945-a71b` |

`deck.json` lists the slides in deck order. Each file in `slides/` is one slide, with its speaker
notes in the `<aside>` element.

The slides refer to an image as `/_blob/<id>`. The image is the file `assets/<id>.png`. The copy
keeps the artifact's image links, so the slide files do not show their images when you open them
directly from git.

`index.html` shows the slides in deck order, without claude.ai (#150). It skips hidden slides, as
the artifact's Present mode does, loads the images from `assets/` and draws the `<x-icon>` and
`<x-shape>` elements. It fetches the slide files, so serve the folder over HTTP: `make pitch` serves
it on port 8001 (the engine port plus one), or run `python3 -m http.server 8001 -d docs/pitch/deck`.
Keys: → Space PageDown next, ← PageUp back, Home End, N speaker notes, F full screen.
`?vis=intervju,bevis` also shows those hidden slides. Print (Cmd+P) gives one slide per page. If a
new slide uses an icon that `index.html` does not know, the slide shows a plain circle: add the icon
to `ICONS`.

`../manus.html` is one complete page. Open it in a browser.
