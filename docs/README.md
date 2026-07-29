# Screenshots

The root README references two images that are not in the repo yet. Capture
them once and the README is complete.

1. Start the app: `npm run dev`
2. Open http://localhost:3000 and let the stream connect (the indicator turns
   green and reads "live").
3. Capture and save here:

| File | What to capture |
|---|---|
| `screenshot-dashboard.png` | The full page at the **24h** window. Ideally with at least one anomaly in the Anomalies panel — switch to **7d** if the 24h window is quiet. |
| `screenshot-simulator.png` | The **What-if simulator** with a routing override applied, so both the projected saving and the quality trade-off are visible. |

Tips:
- Use a viewport around 1440px wide; the layout is at its best there.
- A full-page capture (Chrome DevTools → ⋮ → *Capture full size screenshot*)
  shows the whole dashboard in one image.
- Keep them under ~500 KB each so the README loads quickly.
