# Media assets for the README

The root README references screenshots/GIFs from this folder. **PENDIENTE CARLOS** —
these have to be recorded on a real repo (an agent can't record video/screenshots).

## Screenshots to record

| File | What to capture |
|---|---|
| `hero.png` | The app open on a real repo, graph filling the window (used at the top of the README). |
| `watcher.gif` | Open a repo, edit a file in another window, show the graph re-indexing live within ~2s (the `Live` indicator pulsing). |
| `timeslider.gif` | Drag the history slider across a few scans, show the `+added ~modified −removed` counts and the graph changing, then click **HOY** to return to the present. |
| `chat.gif` | Ask "what does this project do?" in the **Ask Claude** panel, show a cited answer, then click a citation to center that node. |

Suggested capture: Windows Game Bar (`Win+Alt+R`) or ScreenToGif, then trim.
ffmpeg one-liner to turn an mp4 into a size-friendly gif:

```bash
ffmpeg -i in.mp4 -vf "fps=12,scale=900:-1:flags=lanczos" -loop 0 out.gif
```

Until these exist the README stands on its textual step-by-step; the GIFs are polish.
