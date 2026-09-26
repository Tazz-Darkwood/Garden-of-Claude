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

## Time of day and the context window

The sky follows your clock: the sun rises at 6:30, crosses the sky, and sets
at 20:30, with stars and a moon in between, so the light stays steady when
you switch between planters. Morning mist lies on the ground early, leaves
fall at dusk, and the owl and fireflies come out after dark.

How full each session's context is shows as a lantern hanging from the
plant's stake: full and bright when the context is fresh, its oil dropping
and its flame shrinking as the context fills, guttering in the last quarter
before compaction is due, and out and smoking while compaction runs. Hover
it for the numbers. The same figure appears as a small line under the plant's
name tag ("context 27%", turning orange as compaction nears and reading
"compacting" during it), in the session pill at the top, and in the panel's
context meter. The fraction comes from the session transcript: the latest
assistant message's input plus cached tokens, divided by the model's window
(1M for current models, 200K otherwise; override with
`GARDEN_CONTEXT_WINDOW`). Compaction is due at 90% of the window by default
(`GARDEN_COMPACT_AT`). Compaction ends with a brief flash of daylight.

## Themes

The look is a theme, and the numbers underneath are not. A theme is a set of
optional overrides over the garden baseline: the words the interface uses,
names and icons for shop items and species, a sky palette, and canvas
renderers for scene elements and ambient life; anything a theme leaves out
falls back to the garden. Themes are bought with sap on the shop's **Themes**
tab and switched there (the garden is always owned; the choice is remembered
per browser), and `?theme=wizard` in the address previews one.

- **Garden** (default): the plant, the pot, sap, seeds, water, light, nutrients.
- **Wizard tower**: a tower that gains a floor per stage on a rune-carved
  plinth, mana for sap, runes for seeds, ether, starlight, and ley power for
  the meters, a wand and grimoire in the shop, imps for failed tools, wisps
  for bees, an observatory for the greenhouse, and apprentices in pointy hats
  for subagents. Windows light at stage five, a crystal tops the spire at six,
  stones orbit from seven, and a storm ring crackles from eight. The props
  become an ether cistern, a ley stone, a warding sigil, and an astrolabe;
  the sky has a pale violet sun with a corona by day and two moons at night;
  the mailbox is an owl post with a crystal orb, the desk a lectern with a
  spellbook and a hovering quill, the gate an iron gate between rune-lit
  stone pillars with a stone wall behind it, and the lantern a mana vial in
  an iron stand with a crystal hovering over it;
  the ambient life becomes sprites, scarabs, toads, bats, an airship, a
  dragon, embers, slimes, and an aurora in place of the rainbow. 10M sap.

- **Orbit**: a planet that grows from dust and gathering pebbles to a rocky
  world, gains an atmosphere, oceans, life, city lights, rings, and gas-giant
  bands, and collects moons, held over a launch pad on a cratered moon by a
  tractor beam. Stardust, cores, ice, starlight, and minerals; drills and
  tractor beams; rogue drones, probes, a ring station, a comms dish, a
  console, an airlock, a reactor core, helpers in helmets. 10M sap.
- **Jurassic**: an egg that cracks and hatches into a dinosaur that grows a
  size per stage in a nest under a smoking volcano, with a nest of eggs from
  the nesting stage and a crown of feathers for the alpha. Species are
  raptors, a brachiosaurus whose neck follows the sun, an ankylosaurus, a
  parasaurolophus, a stegosaurus, a triceratops, an amber raptor, and a
  tyrannosaurus. Food, eggs, water, sunshine, and ferns; spears and stone
  axes; pterosaurs, beetles, a cave, a message stone, a carving stone with a
  torch, a log gate with a bone fence, a campfire whose wood pile is the
  context, helpers with feathers. 10M sap.

- **Deep reef**: the sky is water, with light shafts by day and glowing
  plankton at night. A coral head grows into a reef by species, gains
  anemones, fish, shoals, and a wreck leaning on it. Pearls, shells, current,
  light, and plankton; nets and harpoons; moray eels, cleaner shrimp, a
  shipwreck, a diving bell, a ship's wheel, a kelp gate, an air tank, divers,
  and a whale, a submarine, jellyfish, and crabs passing through. 10M sap.
- **Clockwork**: a brass machine that assembles itself on a factory floor of
  turning gears: frame, boiler, pistons, gears, lamps, chimney, bell, and an
  orrery. Cogs, springs, steam, oil, and coal; wrenches and lathes; rust
  sprites, sparks, a workshop, a pneumatic tube, a drafting table, an iron
  door, a pressure gauge whose needle is the context, and wind-up helpers in
  top hats. 10M sap.
- **Bakery**: inside the shop, with the street through the window. A cake
  gains a tier per stage on a cake stand, with candles from five, frosting
  drips from six, flowers from eight, and a sugar star at mythic. Sugar,
  recipes, flour, heat, and butter; spoons and whisks; ants, wasps, a pantry,
  an order box, an order pad, the shop door with OPEN and CLOSED signs for
  the permission modes, an oven with a thermometer, helpers in chef hats, and
  balloons, paper planes, and a mouse. 10M sap.

The cat is the same cat in every theme. That is on purpose.

Adding a theme is one object in `game/game.js` (see `THEMES.wizard`).

## What else the garden shows

- **Session title.** The name tag on each pot carries the session's title from
  Claude Code when it has one, otherwise the folder name.
- **Helper gardeners.** Each running subagent is a small gardener raking
  beside the planter; it leaves when the agent finishes.
- **Background jobs.** Each shell command Claude left running in the
  background is a pot on a fire past the gardeners (a pod with a blinking
  light in the orbit and clockwork themes), with its description underneath
  and its running time on hover. The list comes from the hooks, which report
  background work at every Stop.
- **Celebrations.** A shell command that commits throws confetti over the
  planter, a push sends up fireworks, and a test run that passes opens a
  sunbeam (a failing one lands a crow like any failed tool).
- **The gate and the permission mode.** The gate stands open in auto mode.
  In default or accept-edits mode it is closed with a latch, because Claude
  will stop there to ask; in plan mode it wears a "planning" sign. Hover it.
- **Rings on the pot.** One ring per compaction the session has lived through.
- **The hourglass** by the desk runs while a turn is in progress, flips every
  five minutes, and shows the turn's elapsed time underneath. Hover it.

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
  Milestones double a tool at levels 25, 50, and 100. Seven tiers: trowel,
  watering can, shears, trellis, sprinkler, beehive, orchard (each theme
  renames them).
- Runs 1 to 3 (2026-09-24) ran away: linear seed bonuses and square-root
  harvests; then cheap tools and free instant harvests; then prices still
  anchored to a single click rather than a click rate. Their ledgers are kept
  as `logs/economy-2026-09-24-run1.jsonl` through `-run3.jsonl`.
- **Seasons (prestige).** The Almanac panel offers a new season once you have
  earned 10M sap in the current one. It resets sap, tools, skills, garden
  items, seeds, and the plant, and pays legacy points equal to the square
  root of this season's lifetime sap over 10M (400M earns 6). Each unspent
  point is a permanent +5% click power. Points can instead buy legacy perks:
  a head start of ten trowel levels and the can, keeping a quarter of your
  seeds, longer windows, slower meter drains, a higher combo cap, and the
  greenhouse and scarecrow from the start. Themes, legacy, achievements, and
  the ledger survive; the Almanac keeps a row per season. The act is named per
  theme: new season, new age, big bang, extinction event, new tide, rebuild,
  new menu.
- **Achievements.** Fourteen small permanent bonuses of +0.5% click power
  each, for things like a thousand clicks, ten harvests, a mythic plant,
  petting the cat, seeing fireworks, owning every theme, and finishing
  seasons. They unlock as you play and are listed in the Almanac.
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

## The tour

The first visit gets a short tour: eight spotlights, one part of the garden
at a time, each with two sentences on what it does in the game and what it
means for Claude. Skip or Escape ends it, and the **?** in the top bar
replays it any time. The words follow the theme.

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
