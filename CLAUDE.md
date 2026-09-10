# Project context — LIFEPAK-style sim monitor

Read this first. It explains what this fork is, what has been changed and
why, and what is still open. Written by Claude (chat) on 2026-09-10 as a
handover.

## Who is doing this and how

The owner is a medical educator, not a developer. They run in-situ
simulations and want the Gas Notes Simulation Monitor to look like a
LIFEPAK 35 defibrillator/monitor. Everything up to this point was done
from an **iPad only**, editing files through GitHub's web editor in
Safari — no terminal, no local checkout. A Windows PC with Claude Code
has now entered the picture, which is why this file exists.

Please explain things in plain language and avoid assuming terminal
familiarity. Show what a command will do before running it.

## What this fork is

Fork of `samnunn/gasnotes-simulator`. Flask + Flask-SocketIO. A monitor
page displays vitals; a separate controller page (phone) drives them over
websockets. Sim state is stored as text files on the server, keyed by a
SimCode.

## Deployment: Render, from a Dockerfile we added

Live at `lifepak-simulator.onrender.com`, free tier, auto-deploys on push
to `main`.

The upstream repo assumes Docker Compose on a developer machine. Render
builds a plain Dockerfile, so several assumptions broke. We added
**`Dockerfile.render`** (Render's Dockerfile Path is set to
`./Dockerfile.render`). It exists because:

1. **Wrong stage.** The upstream `Dockerfile` is multi-stage and its last
   stage is `test_runner_headed`. Docker builds the last stage by
   default, so Render kept launching the VNC test runner and dying on
   `VNC_PASSWORD must be set`. The stage we actually want is
   `base_server` (gunicorn, gevent worker, port 8069).
2. **Port.** Binds to `${PORT:-8069}` because Render injects `PORT`
   (10000).
3. **Working directory.** Gunicorn couldn't import `app`; fixed with
   `--chdir /simulator` plus `PYTHONPATH=/simulator`.
4. **Sim room store.** `SIM_ROOM_STORE=/sim_rooms`, directory created at
   container start. Note compose mounts it at `/sim_rooms` (root), not
   inside `/simulator`.
5. **esbuild.** This one took several rounds. The app bundles its JS at
   request time via webassets → `app/lib/custom_webassets_filters.py` →
   `subprocess.run` on `/simulator/node_modules/.bin/esbuild`. On Render
   that binary was missing and **every page 500'd**. Current workaround:
   `npm ci || echo ...`, then `npm install -g esbuild@0.25.0` and symlink
   it into `/simulator/node_modules/.bin/esbuild` (creating the directory
   first, since npm ci wasn't producing `node_modules` at all).

**Worth investigating properly:** why `npm ci` produces no
`node_modules` in the Render build. The global-install symlink is a
workaround, not a diagnosis. If you can reproduce a Linux build locally,
that's the fastest way to find out.

Free tier caveats the owner knows about: sleeps after 15 min idle (~1 min
cold start), and no persistent disk, so `/sim_rooms` is wiped on restart.

## The reskin

Only `app/templates/sim_views/sim_monitor.html` was changed. The
controller page is untouched and must stay that way.

**Key constraint — do not break this.** The app renders through custom
elements `<sim-trace>` and `<sim-readout>`, bound to the server by
`data-sim-parameters` attributes. The reskin deliberately preserves every
one of those tags, their attributes, ids and `data-testid`s byte-for-byte,
and only restructures and restyles the markup around them. If you need to
change waveform behaviour, change the renderer
(`app/static/js/wavemaker2.js`), not the bindings.

What the skin does:

- Rows of `[coloured tab] [white numerics] [waveform lane]`, top to
  bottom: ECG, capnograph, pleth, art line, NIBP.
- Numerics are white; colour lives in the left tabs (HR green, EtCO₂
  orange, SpO₂ blue, ART red, NIBP grey). Trace `stroke-colour`
  attributes were changed to match.
- Alarm flash: the original CSS used `currentColor` as the flash
  background, which on white numerals would flash white-on-white. It now
  flashes red. Don't revert that without also reverting white numerics.
- RR moved under EtCO₂ as a sub-value. `#rr-source` span kept — JS writes
  into it.
- Layout fix that matters: `#sim-monitor` needs `height: 100%`,
  `min-height: 0`, `overflow: hidden`. Without `min-height: 0` the grid
  refuses to shrink below its content inside the flex column and the
  bottom row falls off the screen.
- `sim-trace` keeps its original positioning contract — absolutely
  positioned, `left` set dynamically by wavemaker2.js, `transform-origin:
  top`, scaleY varying by viewport height. Those scale values were
  halved from upstream because the ECG drew far too large on iPad.

## Open items

1. **ECG stroke weight.** The owner says the ECG line looks too thick.
   Amplitude was reduced via CSS scaleY and `y-scale="0.7"` on the ECG
   trace, but the actual stroke width lives in the renderer and was never
   investigated. Read `app/static/js/wavemaker2.js` and find out whether
   a stroke-width attribute exists or can be added.
2. **Second ECG lead.** The reference LIFEPAK screen shows leads II and
   III. The app generates one ECG trace. A second lane would need a
   `mode="copycat" pacemaker="ecg"` trace, or renderer work. Not
   attempted.
3. **Top status strip and soft-key bar.** The LIFEPAK reference has a top
   bar (patient, elapsed timer, batteries, energy) and a bottom soft-key
   row (12-LEAD, EVENTS, ALARMS, THERAPY). Not built — this template's
   toolbars come from `layouts/sim_layout.html`.
4. **Fullscreen.** PWA meta tags were to be added to
   `app/templates/layouts/base.html` so the site can be added to the iPad
   home screen and launch without Safari chrome. Check whether that got
   done.
5. **Wake lock.** The iPad sleeps mid-scenario. Screen Wake Lock API
   would fix it; needs JS, not a meta tag. Not started.
6. **Local hosting.** Now that there's a PC, running locally via
   `docker compose -f compose.base.yaml -f compose.dev.yaml up` removes
   the dependency on sim-room internet, which is patchy and locked down.
   Render is then just a backup. Worth setting up.

## Reference

The visual target is the LIFEPAK 35. Deliberate choice: build a visual
homage, **not** a pixel clone. No Stryker branding or wordmark — partly
IP, partly so nobody mistakes the sim for a real device. The wordmark
slot currently reads "SIM MONITOR" in the standalone mockup.

There is also a standalone HTML mockup of the skin (not in this repo)
that the owner has, built before the transplant. It has its own canvas
waveform renderer and demo sliders. It was a design reference only — the
live implementation uses the app's own renderer.
