# Garden of Claude

A clicker game that's secretly a Claude Code interface: watch, reply, and
pause without opening the app.

An idle garden that lives beside Claude Code and turns its work into weather.
Claude's searches fall as rain, its edits rise as sun, its commands blow past
as wind. A plant grows while Claude works and multiplies your clicks; the sun
crosses the sky as Claude's context fills; a visitor waits at the gate when
Claude needs permission; letters arrive when it has a question; and a writing
desk lets you answer, or start it on something new, without opening the app.

It costs no tokens. It only listens, through Claude Code's hooks and the
session transcript, and it runs on whatever plan you already have.

## Contents

| Path | What it is |
|---|---|
| `install.js` | adds or removes the hooks in `~/.claude/settings.json` |
| `hooks/relay.js` | what the hooks run: forwards each event to the server, returns its answer, starts the server on session start |
| `server/server.js` | the local server: receives hook events, streams them to the page, holds turns for replies, keeps the shared save (Node, no dependencies) |
| `game/` | the page: `index.html`, `game.js`, `style.css` |
| `.claude/launch.json` | lets the Claude desktop app start the server and open the page in its browser pane |
| `logs/` | created at runtime, ignored by git: event history, letters, the save, economy ledgers |

## How it works

1. **Hooks** in `~/.claude/settings.json` hand every Claude Code lifecycle event
   to `hooks/relay.js`, which posts it to a local server and prints the server's
   answer. The relay always exits cleanly, even when the server is not running,
   so Claude never notices when the game is off; on `SessionStart` it starts the
   server if nothing is listening. `PreToolUse` waits for a reply (the pause
   gate) and `Stop` waits for one (the mailbox and desk); every other event runs
   async.
2. **Server** (`server/server.js`, Node, no dependencies) receives the events on
   `POST /hook`, streams them to the page over Server-Sent Events, tracks each
   session's status, appends them to `logs/events-YYYY-MM-DD.jsonl`, and holds
   the pause flag.
3. **Game** (`game/`) is a plain canvas page served by the same process.

## Running it

### The easy way: let Claude install it

If you use the Claude desktop app and never touch a terminal, paste this into
a Claude Code session and let it do the work:

> Install Garden of Claude from https://github.com/Tazz-Darkwood/Garden-of-Claude
> and open it in the browser pane. Follow the "For Claude" checklist in its
> README.

After that the garden starts itself whenever you open a Claude session. To see
it again later, just ask: "open the garden".

<details>
<summary><b>For Claude: the install checklist</b></summary>

1. Check for `git` and `node` (`git --version`, `node --version`). If either is
   missing, install it: on Windows `winget install --id Git.Git -e` and
   `winget install --id OpenJS.NodeJS.LTS -e`; on macOS `brew install git node`;
   on Linux use the distribution's packages. Open a fresh shell afterwards so
   the new commands are on the path.
2. Clone the repo into the user's home folder:
   `git clone https://github.com/Tazz-Darkwood/Garden-of-Claude "~/Garden-of-Claude"`.
3. In that folder run `node install.js`. This adds hooks to
   `~/.claude/settings.json`; they take effect without a restart.
4. Start the server once now: run `node server/server.js` from that folder in
   the background. From then on it starts itself with each new session.
5. Open <http://127.0.0.1:47831> in the browser pane (a URL preview) so it
   sits beside the chat, and tell the user the flag on the mailbox means a
   letter and the desk lamp means Claude is ready for a note.
6. Nothing else is needed. The hooks never touch the user's data, and the
   folder can be deleted after `node install.js --remove` to uninstall.

</details>

### By hand

```bash
git clone https://github.com/Tazz-Darkwood/Garden-of-Claude
cd Garden-of-Claude
node install.js          # adds the hooks to ~/.claude/settings.json (once)
node server/server.js    # starts the garden now; later sessions start it themselves
```

Then open <http://127.0.0.1:47831> in any browser. In the Claude desktop app,
ask Claude to open the `garden` preview and it appears in the browser pane
beside the chat. `node install.js --remove` takes the hooks out again.

Requirements: Node 18 or newer, and Claude Code in any of its forms. The
hooks run a small Node script directly, with no shell, so they behave the same
on Windows, macOS, and Linux.

## Where it works

Anything that is Claude Code underneath: the terminal CLI on Windows, macOS,
or Linux, the VS Code and JetBrains extensions, and the desktop app. They all
read the same `~/.claude/settings.json` hooks, write the same transcript
files, and honor the same Stop-hook reply, so the mailbox, desk, pause gate,
and journal all work the same. The hooks run Node directly, so they need no
shell and no other tools. While a turn is held the host shows Claude as still
running, whatever the host is.

An app built on the Claude Agent SDK also works when it loads user settings
(the default `settingSources`), since the same hooks fire there; its own UI
decides what a held turn looks like. It bills through an API key, which is
the SDK's rule, not this project's.

What does not work: sessions running on another machine. Cloud sessions,
Remote Control targets, and SSH sessions run their hooks where the session
runs, and the garden server listens on this machine's loopback only. To
watch a remote session you would run the server there and open its page.

## Weather key

| Claude does            | You see                                   |
|------------------------|-------------------------------------------|
| Grep, Glob, Read       | Blue rain made of the pattern or filename |
| Edit, Write            | Warm sun motes rising with the filename   |
| Bash, PowerShell       | The command blowing across as wind        |
| Agent, subagents       | Clouds carrying the task description      |
| Web, browser, MCP      | Birds carrying the URL or tool name       |
| Turn ends              | Message on the board; a letter only if Claude asked you something |
| Permission or question | Amber pulse, "Claude needs you"           |
| Nothing for a while    | Fog                                       |

## The sky is the context window

The sun's position is how full Claude's context is. Dawn is an empty
context, noon is halfway to the compaction threshold, and dusk with the first
stars means compaction is due: let auto-compact run or trigger it yourself.
Compaction itself is night with a moon, and the new day dawns when it finishes.

The fraction comes from the session transcript: the latest assistant message's
input plus cached tokens, divided by the model's window (1M for current
models, 200K otherwise; override with `GARDEN_CONTEXT_WINDOW`). Sunset is at
90% of the window by default (`GARDEN_COMPACT_AT`). Each session pill shows its
own sun or moon and percentage; click a pill to make the sky follow that
session.

## Planters, stakes, and the gate

Each live session gets its own planter, labelled with the project folder and a
status lamp. The plant in it grows over time while that session's work keeps
its meters up, and your clicks draw sap from it. A stake in each planter shows
the prompt Claude is working on; hover for the full text. When a session ends
its plant is harvested automatically for whatever seeds it had earned. Click a
planter to focus it; the sky and the meters follow the focused session.

The gate on the right is open while Claude works and closed while paused.
When Claude needs permission or asks a question, a visitor waits at the gate
holding a sign with the tool and command in question; answer it in the app.

## Gameplay

The economy follows the standard incremental formula, bent so that nothing
ever clicks for you. Claude's work produces resources; your clicks turn them
into sap; upgrades make your clicks better.

- **Sap** is the one currency. Every click earns click power times the plant's
  stage multiplier, times a meter factor (water, light, and nutrients), times
  the combo, times any open window, times five to ten on a crit. Spending sap
  never affects the plant.
- **Meters** drain over fifteen to twenty minutes. Every tool call Claude makes
  feeds all three a little, and the kind adds a bonus: reads and searches add
  water, writes add light, shell commands add nutrients and a splash of water.
  An ordinary hour of work keeps the plant healthy whatever the tool mix.
- **Combo** builds with steady clicking and drains in eight seconds when you
  stop, multiplying clicks up to two times (3.5 with upgrades).
- **Windows are the golden cookie.** When Claude writes a file a sunbeam lands
  on that planter for eight seconds and clicks inside pay three times (four
  upgraded). Rain leaves a puddle worth 1.5 times (double upgraded) for six
  seconds. Passing birds can be caught and crows from failed tools shooed for
  a bonus. Watching Claude pays.
- **Crits** start at 1% for five times, up to 6% for ten times.
- **Trickle and burst** scale with the square root of your click power, so
  Claude's own work keeps a plant alive while you are away but never outruns
  your clicking. A crow halves the trickle.
- **The plant grows itself and multiplies your clicks.** It gains one stage
  per two minutes of healthy time, and it is healthy while its meters are up,
  which is Claude's work. Clicks do not grow it; they draw sap from it, and
  every click is multiplied by 1 + 0.3 × stage, so a fruiting plant pays 2.8
  times a seed and a mythic plant about five. The stage label shows the
  multiplier, and a thirsty face when the meters are too low to grow.
- **Harvest is the decision.** A fruiting or better plant can be harvested for
  seeds (one at fruiting, one more per stage beyond), which multiply click
  power by 1 + 0.25 × √seeds forever. But you start over from a seed and lose
  the plant's multiplier, so the question is always: keep the big plant, or
  bank it.
- **Tool tiers** are priced against real play: steady clicking with combo and
  windows is worth about twenty base clicks a second, so a trowel is 1,000
  sap (a minute's work), each tier costs about eight times more per point of
  power, and a tier becomes the better buy around level 15 of the one before.
  Milestones double a tool at levels 25, 50, and 100.
- Runs 1 to 3 (2026-09-24) ran away: linear seed bonuses and square-root
  harvests; then cheap tools and free instant harvests; then prices still
  anchored to a single click rather than a click rate. Their ledgers are kept
  as `logs/economy-2026-09-24-run1.jsonl` through `-run3.jsonl`.
- **Shop.** Tools add flat click power and cost 15% more per level, doubling at
  levels 10, 25, and 50. Skill upgrades raise the combo cap, slow its drain, add
  crit chance and size, lengthen or brighten the windows, and (the mouse
  saver) repeat your click while you hold the button, from three a second up
  to seven, a touch faster than a fast thumb. Garden items are the barrel,
  compost bin, feeder, scarecrow, and greenhouse.
- **Harvest.** The plant keeps growing past fruiting through wild, overgrown,
  glowing, enchanted, monstrous, ancient, and mythic, getting bigger and
  stranger. Harvest it by hand any time after fruiting for seeds, which scale
  with the square root of its sap; each seed is a permanent 5% on click power.
  A session ending harvests automatically.

## Mailbox and replying from the game

When Claude finishes a turn, the server reads Claude's closing message out of
the session transcript. If it asks you something it becomes a letter: the
mailbox flag goes up and a banner offers to open it. The letter shows what you
asked, anything Claude said earlier in the turn, and the closing message
rendered as markdown. A plain closing message is not a letter: it appears on
the board, the log notes that the desk is open, and nothing says "your turn".

While the game page is open, the server holds Claude's `Stop` hook until you
reply, press "Let Claude finish", or type in the app (the server watches the
transcript for a queued app message and releases the hold so it can run). Set
`GARDEN_HOLD_MS` for a timed hold instead; reading or typing in the letter
keeps a timed hold alive. Replies ride back through the hook, so Claude
continues in the same session inside the app with your message. During the
hold the app shows Claude as still running; that's the hold, not a hang. If no
game page is connected, Stop is never held.

Letters exist only for questions: when Claude's closing message asks you
something, the flag goes up, the banner and chime fire, and the letter waits
for you to open and answer it. Everything else Claude says appears in full on
the **board**, the column in the upper right, which is the running
conversation with the focused session: your prompts, Claude's messages, and
its between-tool thoughts.

The **writing desk** next to the mailbox is how you talk to Claude without the
app. When Claude is standing by (its lamp is lit) a note goes straight to it.
When Claude is busy the desk queues the note and hands it over the moment the
turn ends. When Claude has finished its turn in the app (after a `/compact`,
an interrupted turn, or a letter you let it finish), nothing outside the app
can start a new one: the desk says so, keeps the note, and it goes in with the
next message you type in the app. The intended flow is: start the app, start
the server, minimize the app, and run the session from the garden.

## Stats and tuning

The **Stats** button opens the economy ledger: income per minute, a stacked
chart of the last hour by source (click, crit, window, trickle, burst, shoo,
bird), all-time and recent totals per source, the exact formulas with the
current numbers filled in, and a log of harvests and purchases. Each closed
minute is also appended to `logs/economy-YYYY-MM-DD.jsonl` for analysis. The
knobs are the `TUNING` object near the top of `game/game.js`.

## The plant

Each stage adds something you can name. Sprout and seedling have cotyledons
and a single stem. Young plant branches once, bush twice with buds at the
tips. Flowering has petal flowers in a palette fixed per plant, fruiting adds
berry clusters. Wild grows vines from the low branches, overgrown darkens the
leaves and puts mushrooms and moss on the rim. Glowing plants have
bioluminescent leaves, an aura, and fireflies; enchanted ones cycle their
flower colors and shed drifting petals. Monstrous plants thicken and grow
thorns, ancient ones turn olive, spill roots over the planter, hang moss, and
hold a nest. Mythic plants carry crystal fruit, halo rings, and orbiting
motes; each mythic tier adds a ring, and from mythic III aurora ribbons and
then star bursts appear. Branch shapes are seeded by the session id, so a
plant keeps its shape from frame to frame.

**Species.** Every new plant is a random species, with rarity: leafy green
and sunflower are common, cactus and lavender uncommon, rose bush and bonsai
rare, crystal fern epic, moonbloom legendary. Each has its own shape and a
small perk (cactus drains water slowly, sunflower keeps its light, rarer
species yield more). Harvesting rolls a new one, and the species and rarity
show in the stage label's color and the planter tooltip.

Open <http://127.0.0.1:47831/?gallery=1> to see every stage side by side,
`?gallery=1&species=cactus` for one species, or `?gallery=1&species=all` for
every species at five stages.

**Ground and scene.** There are distant hills tinted by the sky, a grass
ground with tufts that sway in the wind, pebbles, a worn path, and every
object casts a shadow and dims with the daylight.

## What goes where

Each fact is shown once. Small things fly; big things go to the board.

- **The air.** Every tool call is one line crossing the open sky in one of six
  lanes. Lines in a lane share a speed and are spawned with a gap, so they never
  overlap; a backlog makes the lane speed up. Commands fly as they start,
  results (edits with line counts, search hits, command output) fly as they
  finish. Reads only fall as rain, since the filename is the whole story.
- **The board** (upper right) is the conversation: your prompts, Claude's full
  messages, and its between-tool thoughts. The strip at its bottom is the log:
  every tool result with its detail line, plus harvests, purchases, and
  session events.
- **The activity line** under the pills says what Claude is doing right now.
- **The Journal** button (or the J key) is the same story as the board and log,
  in one scrollable page.
- Only one panel is open at a time: shop, journal, stats, desk, or letter.

## Pause

**Pause Claude** makes the server answer Claude's next `PreToolUse` hook with a
deny and a message telling Claude to stop and wait. `Resume Claude` clears it.
`POST /pause` with `{"paused": true, "seconds": 300}` pauses with an auto-resume.
Pause is global across sessions.

## One garden, any browser

The save lives on the server (`logs/save.json`), not in the browser, so the
app's pane and your own browser show the same garden. The window you last
clicked or bought in is the writer; any other open window mirrors it and says
so in the panel. Click in a mirroring window and it takes over.

## Ambient life

Things happen on their own: wind gusts that blow leaves across and bend the
grass, drifting clouds, distant flocks, dandelion seeds, falling leaves at
dusk, fireflies at night, a rabbit along the path, ladybugs and snails on the
rim, butterflies at the plant, bees during quiet stretches, shooting stars at
night, a kite when the wind is up, a hot-air balloon and a plane with a
contrail now and then, a rainbow when a spell of rain clears under a bright
sky, an owl on the mailbox after dark, morning mist while the context is
fresh, and a cat that wanders in and sits by the desk for a while.
Butterflies, ladybugs, snails, bees, and shooting stars can be clicked for a
bonus, and the cat pays for the first pet of each visit; the rest are just
for watching.

## Turning it off

The **Quit** button in the game (click it twice) ends any held turn so Claude
is not left waiting, writes the save, and stops the server; `npm stop` does the
same from a terminal. The hooks start the server again at your next Claude
session, and while it is stopped they simply fail silently.

To turn the garden off for good, run `npm run remove-hooks` (or remove the
`hooks` block from `~/.claude/settings.json`, or set `"disableAllHooks": true`
there).

## License

MIT. See `LICENSE`.
