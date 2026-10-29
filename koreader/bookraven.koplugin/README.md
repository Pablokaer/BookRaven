# BookRaven for KOReader

A KOReader plugin that brings BookRaven to e-ink readers (Kindle, Kobo, PocketBook…):

- **Library home** (the start screen, like the Kindle's own home). It shows:
  - *Continue reading*: the last book you opened, with its cover, progress and page. Tap it to open the book.
  - *Shelves*: your BookRaven catalog's shelves as tiles illustrated with Gustave Doré's engravings for *The Raven*. Tap one to open it.
  - *Folder shelves*: tap **+ Add shelf** (on the Shelves heading, or the + tile) and long-press a folder on the device to choose it. The folder becomes a shelf with its name. Tapping it opens a gallery of its books as cards with their covers, like *My library*. Sub-folders appear as folder cards you can open; tap a book to read it. Long-press a folder shelf to remove it; the folder and its books stay on the device. When the home runs out of room, the last tile opens *All shelves*.
  - *New in your library*: covers from the catalog's recently added shelf, when the screen has room.

  The top bar has the raven (below), **Wi-Fi** (its icon shows whether Wi-Fi is on; a tap turns it on and connects, or off, at once, with a short *Connecting…* or *Wi-Fi off.*; a long-press while it is off also shows KOReader's list of networks), search (below), the quick settings (the chevron, below), the file browser and KOReader's menu. Its icons are the size of KOReader's own title bar icons (the file browser's), so they are easy to tap on a Kindle; they only shrink on a screen too narrow for them. Shelves and new books are saved on the device, so the home shows at once and refreshes when KOReader is online. *New in your library* only shows the books of the account that is set up (none without an account).

  **Offline**, the Shelves section has a single shelf, *On this Kindle* (*On this device* on other e-readers): every book on the device (the places search looks, below), as a gallery of cards with covers, sorted by title. Tap a book to read it; its magnifier searches the device's books, and the back arrow returns to the full shelf. The catalog's shelves, your folder shelves, *+ Add shelf* and *New in your library* are hidden until the BookRaven server can be reached again; then they come back by themselves, with one screen refresh, without restarting. *Continue reading* stays, and the home's magnifier searches only the device meanwhile. "Offline" means no network, or a network without the server: the plugin asks the server's `/api/health` (2-second timeout, the answer kept for a minute), so a server on your home network works without Internet. The home follows KOReader's *NetworkConnected* and *NetworkDisconnected* events (Wi-Fi turned on or off), and checks again every 90 seconds while it is on screen (a server stopped or started). Turn it on with Settings → BookRaven → *Start with the BookRaven library*, or open it from *BookRaven library* in the file browser's ☰ menu. With that setting on, the home also comes back when you close a book.
- **The raven: back to the library from anywhere.** The theme's raven (its home button: the medallion, the glitched raven, or a plain raven in a circle for *Classic e-reader*) sits at the top left of every plugin screen: folder shelves, *On this Kindle*, *All shelves*, search results, and KOReader's OPDS catalog (its own menu button moves just right of the raven). A tap closes every screen open over the file browser and brings back the library home, never a second copy of it. On the home itself, a tap asks the server again and lays the home out anew (a long-press opens KOReader's menu). In the file browser, the top-left home button becomes the raven and opens the library when a theme is on or the library is the start screen (*Go to HOME folder* stays in its + menu, and a long-press still opens its folder menu); otherwise it is KOReader's own. Inside a book nothing is added.
  - The back arrow of a catalog shelf opened from the home goes back to the home (not up to the catalog's start); a long-press on it still goes to the list of catalogs.
  - **Whole-screen refreshes.** Each plugin screen (the home, shelves, search results, the catalog) comes and goes with one full-screen flashing refresh (*flashui*), so on e-ink nothing of the previous screen stays behind. (Before, leaving the home for the file browser refreshed only the tapped icon's corner, and the rest of the panel kept showing the home.) Opening a book adds no flash of its own: KOReader's reader refreshes the whole screen. At start-up and after closing a book, the home goes over the file browser before anything is drawn, so the file browser never flashes by.
- **Search everything** (the magnifier on the home's top bar). One search, by title, author or file name (capitals and accents don't matter), over:
  - the books on this device: KOReader's home folder, your folder shelves, the download folder, the last folder you were in and the books you have opened. Titles and authors come from KOReader's book information cache (the cover browser's) when it has them, else from the file name (`Author - Title.epub`). The list is made the first time you search and kept for ten minutes; the walk skips hidden folders, `.sdr` folders and KOReader's own folder, and stops after 6000 books, 2500 folders or 4 seconds, so it stays quick on a Kindle;
  - your BookRaven library, through the catalog's own search;
  - the Public Library. The server has no search for it, so its *All books* feed is read once per session (up to 20 pages, 1000 books) and searched on the device.

  The results are one grid of cards with covers. Each card shows its file type (EPUB, PDF, CBZ, FB2, MOBI…: every format KOReader opens) and where the book is: *On device · folder*, *BookRaven library* or *Public Library*. Tap a book on the device to open it. Tap a catalog book to download it into KOReader's download folder (or your home folder) and open it; if it is already there, it just opens. Long-press a catalog book for KOReader's download dialog (formats, folder, book information). The magnifier on the results searches again.
- **A magnifier in every shelf**, next to the close button:
  - a folder shelf: searches its folder and every folder inside it;
  - a catalog shelf: searches all of its pages (on *My library*, *Recently added* and the catalog's start, the server searches the whole library; the catalog's start adds the Public Library);
  - a page of shelves (such as the Public Library): searches its *All books* feed, or each shelf on it;
  - *All shelves*: every shelf at once, your folders and the catalog.

  The books found appear in the same grid. The back arrow, or *Clear search* in the magnifier's dialog, returns to the shelf.
- **Quick settings**, a panel that comes down from the top of the screen, like the Kindle's:
  - *Wi-Fi*, first and full width, like the Kindle's own toggle: the Wi-Fi icon, its state (*Connected to* the network's name where KOReader knows it, *Connecting…*, *Off*) and an on/off switch. One tap turns it off, or on and connects to a known network (KOReader shows its list of networks when it knows none), with no confirmation: it does what KOReader's *Toggle Wi-Fi* gesture does. A long-press while it is off turns it on and shows the list of networks. It follows KOReader's network events, so it is always up to date, and it is only shown on devices where KOReader controls Wi-Fi (not on Android or desktops). The offline home follows these changes by itself.
  - *Dark mode* (KOReader's night mode), *Bold text* and *Light* (the frontlight on or off);
  - *Brightness*: a slider between a small and a large sun (tap a sun for one step). *Warmth* too, on devices with a natural light;
  - *Text size* (A− / A+ from 80 % to 150 %; tap the value for 100 %) and *Font*: the theme's own, Noto Sans, Noto Serif, Inter, Cormorant or Chakra Petch.

  Text size, bold and font change the plugin's screens (home, shelves, cards, search) at once, and are saved (also in Settings → BookRaven → *Text*). With a theme on, KOReader's menus and dialogs take them at the next start: the panel then shows a *Restart* button. Brightness, warmth and dark mode are KOReader's own settings.

  Open it with a swipe down from the top edge of the plugin's screens (the home, folder shelves, *All shelves*, search results and the catalog's cards view; a swipe down lower on a shelf still closes it), the chevron on the home's top bar, the **sun at the end of KOReader's top menu tabs** (after ☰, in a book and in the file browser: the menu closes and the panel comes down over the page; a swipe down at the far right still opens ☰), Settings → BookRaven → *Quick settings…*, or any gesture you assign to *BookRaven quick settings* (Settings → Taps and gestures → Gesture manager), which also works in a book. Inside a book, KOReader's own swipe down from the top (its menu) is left alone. It is made for e-ink: no animation and one refresh per change. Close it with a tap below it, a swipe up, its close button or the handle at its bottom.
- **Theme** (Settings → BookRaven → Theme). Changing it restarts KOReader.
  - *KOReader (original)* leaves KOReader's look untouched. The home, shelf tiles and cards still work, in KOReader's fonts.
  - *BookRaven* is the look of bookraven.cloud, modern with engraved details:
    - Type: titles in Cormorant Garamond, the interface in Inter.
    - Ornaments: a star-and-hairline ornament under titles.
    - Icons: a fine line icon set throughout (menu tabs, arrows, check boxes, radio buttons), and the raven medallion as the home button.
    - Menus and dialogs: the open menu tab marked by a short bar with a diamond, lighter separators, rounded dialogs.
    - File browser: book rows with a shadow under the cover and a thin reading-progress bar.
  - *Cyberdeck* is neon noir, after the console cowboys of 1980s cyberpunk fiction:
    - Type: angular Chakra Petch with a monospace status line (Share Tech Mono).
    - Title bars: black HUD bars with uppercase titles and a cut corner.
    - Icons: an angular icon set, the open tab shown as an inverted block, and a glitched raven as the home button.
    - Menus and dialogs: dashed separators and square dialogs.
    - Covers: corner brackets around covers, and scanlined engravings and stand-ins.
    - Library: **CyberUI** (below) instead of the library home.
- **CyberUI**, the Cyberdeck theme's library: a cyberpunk console laid out as screens, with a status bar on top (*CYBR//DECK*, the time, battery, and CPU and memory use) and a bottom bar *Home · Library · Caches · Log · System* (the active tab in the accent colour). Every page has a back block at the top left; a swipe down from the top edge (or a tap on the status bar) opens the deck; a swipe left or right turns the page of a paged screen. The clock refreshes once a minute, on its own small area.
  - **Home**: *CYBERDECK // KINDLE // OPERATOR ACCESS* and *READER // ONLINE* (or *OFFLINE*: the same server check as the library home; tap to check again, long-press for KOReader's menu); *INDEX OK … N BOOKS* (the books the search found on the device); the day, with the reading streak, today's minutes and the daily goal; *SYS* (diagnostics); **ACTIVE_FILE**, the book you are reading, with its progress as a heartbeat line, *N% DECRYPTED*, when it was last opened and *RESUME* (tap the cover for its dossier); **RECENT_FILES** (the reading history: tap to read, long-press for the dossier); the menu: *Library*, *Collections*, *History*, *Search* (search everything, as on the library home), *Uplink* (the BookRaven catalog, or the account setup) and *System*; and the prompt *ROOT@KINDLE:~#*, which leaves for KOReader's file browser. In landscape the menu sits beside the active file.
  - **Library**: KOReader's home folder and the folders in it. The path as tags (tap one to go back up to it); filters *All*, *Reading*, *Unread* (never opened) and *Done*, with their counts; a grid (3, 4 or 5 per row; two more in landscape) or a list; sorting by title, author, last opened, newest or progress; search in this folder and the folders in it; *+ New* makes a folder. Folders come first as stacked cards (*FOLDER // N*). Each book's cover is framed with a cut corner and tagged *NEW* or with its percentage, and has a progress bar under its title. Tap a book to read it, long-press it for its dossier. Covers missing from the cache are extracted one at a time after the page shows. Paged (*SECTOR 01 / 03*).
  - **Covers** (System → Covers): the image, a text card, or **ASCII art**: the cover drawn as characters, tinted with its colours on a colour screen and in greys on e-ink (in dark mode bright parts are drawn, in light mode dark ones; each cover's contrast is stretched first). Characters: *Classic*, *Detailed* (a 70-step ramp), *Braille* (2 × 4 dots per cell), *Blocks*, *Binary*, *Hex dump*, *Glitch* (shifted rows and noise) or *Book title*; density fine, medium or coarse. The last 48 drawn covers stay in memory.
  - **Caches**: KOReader's collections, *Favorites* pinned on top with its covers fanned out, the others as cards with four covers; the BookRaven catalog's shelves (*UPLINK*, online with an account) and your folder shelves (*MOUNT*), then *+ Mount* to add one. *+ New* makes a collection; long-press one to rename or delete it, long-press a folder shelf to remove it. Tap a collection to see its books in the library's grid.
  - **Log** (*TELEMETRY.LOG*), from KOReader's *Reading statistics* plugin: time and pages this week, the streak (and the best one), minutes read each day this week with the daily goal as a dashed line, a 12-week activity grid (empty, some reading, goal met) and the last sessions (a book's pages with less than ten minutes between them). Without statistics it says how to turn them on.
  - **Diagnostics** (*SYS* on the home): *POWER CELL* (charge, state, the drain per hour and hours left, measured after 20 minutes on battery, and when it was last charged), *CORE* (CPU use, clock, cores, load, memory, KOReader's memory and threads), *UPLINK* (network, address, Wi-Fi, SSH when a server listens on 22 or 2222, the BookRaven server), *STORAGE* (the library's disk and the books found), *OPTICS* (the screen, colour or greys, the frontlight, rotation, night mode) and *UPTIME* (device, KOReader, asleep, wakes). *RESCAN* reads everything again. From KOReader and `/proc`; what a device does not tell shows as `--`.
  - **File dossier** (long-press a book anywhere, or tap the active file's cover): the cover, title, author, format and size, pages, when it was added and opened, its collections; *DECRYPTED N%* and its status with the heartbeat; the synopsis (tap for the next lines); highlights, notes and bookmarks; *Open file*, *Mark done* (or *Mark unread*), *Collection +* (add it to collections or take it out, or start one), *Show folder*, *Rename*, *Move to* and *Delete*, which keep KOReader's reading position, history and collections in step, as the file browser does.
  - **System** (*~/.CYBERUI/CONFIG*), in tabs: *Look* (seven colour schemes with their swatches, Mono, Graphite, Neon, Synthwave, Bloodline, Terminal and Amber; **Light or Dark** mode; book progress as a heartbeat, blocks or a bar), *Covers* (above, with a preview), *Fonts* (text size, bold, font family), *Home* (the daily goal, recent files, CPU and memory in the status bar, starting with CyberUI, the account), *Speed* (a full refresh when turning library pages, clearing the ASCII and cover caches, counting the device's books again) and *About* (versions, credits, and switching theme). Changes apply at once.
  - **Colour**: on a colour e-ink screen with KOReader's colour rendering on (a Kindle Colorsoft, a Kobo Libra Colour) the schemes show their colours (Neon: cyan and red on near black). On a grey screen each colour role becomes a grey kept in a band that reads well on e-ink (dark mode: light text on near black, mid-grey accents with black text; light mode the reverse), so the schemes differ only in contrast. KOReader's own menus and dialogs keep the Cyberdeck theme's light look; KOReader's night mode inverts everything, CyberUI included.
  - **The deck** (the quick settings with this theme, opened the same ways): shortcuts to the home, library, diagnostics, *System → Look*, search, a full refresh of the screen and KOReader's menu; the time, battery, connection, storage, memory and uptime; *LUMEN* and *TINT* (frontlight and warmth) with − and +; *Wi-Fi*, *Night mode*, *Rotate*, *Restart* and *Exit*. Inside a book (the sun tab, or the gesture) its first shortcut closes the book and opens CyberUI, whatever the start screen.
  - *Classic e-reader* is inspired by the Kindle's stock look, without any of Amazon's fonts, icons or artwork:
    - Type: KOReader's own Noto Sans, black on white.
    - Title bars: the title on the left, the buttons on the right, a hairline under the bar. The home's top bar reads *Home*, the file browser *Library*.
    - Icons: a thin line icon set drawn for the plugin, square check boxes, the open menu tab marked by a plain bar.
    - Home and shelves: no engravings or ornaments; plain section headings, shelves as a small stack of covers, square cards with hairlines.
    - Covers: in a grid with their titles below, starting under the cover's left edge; books without a cover get a white stand-in with the title in bold.
- **Cards view for OPDS** (Settings → BookRaven → Catalog view, or the ☰ menu inside any catalog):
  - Books: pages that list books show a grid of cards with the cover, title and author instead of a text list. Sizes: 3 × 2, 3 × 3 or 4 × 3 per page.
  - Shelves: pages that list shelves show illustrated tiles.
  - Covers: they come from the catalog's OPDS image links. Each is downloaded once, shrunk and cached in `koreader/cache/bookraven-covers`, and the next page's covers are fetched ahead.
  - Books without a cover get a stand-in drawn by the theme.
  - The cards view works with any OPDS catalog that sends cover links, not only BookRaven.
- **One-step account setup** (Settings → BookRaven → Set up BookRaven account): enter the server, your email and an app password (BookRaven → Profile → Other apps). The plugin checks them, adds the "BookRaven" OPDS catalog, and points progress sync at `<server>/kosync` with the same login (Binary document matching).
- **BookRaven library** at the top of the file browser's ☰ menu, and as an action you can assign to a gesture (Settings → Taps and gestures → Gesture manager), like *BookRaven quick settings*.

## Install

1. Copy the `bookraven.koplugin` folder into KOReader's `plugins` folder:
   - Kindle: `koreader/plugins/` on the Kindle drive.
   - Kobo: `.adds/koreader/plugins/`.
   - Other devices: the `plugins` folder inside KOReader's folder.
2. Restart KOReader.
3. Settings (gear) → BookRaven → Set up BookRaven account.
4. Optional: Theme → BookRaven, Cyberdeck (with CyberUI) or Classic e-reader, Start with the BookRaven library, Catalog view → Cards.

To remove it, disable it in Tools → More tools → Plugin management or delete the folder.

## Compatibility

Written and tested against KOReader v2026.07.2, the current stable release, at the Kindle Paperwhite's resolution in portrait and landscape; search, quick settings, the Classic e-reader theme, the sun tab and the offline home were tested on KOReader v2026.07.1's emulator (offline: the emulator's *Wi-Fi connection* toggle, starting with it off, and stopping and starting the server). The raven, the Wi-Fi toggle, the larger top-bar icons and the whole-screen refreshes were tested on the same emulator in all four themes (screen changes checked in KOReader's refresh log, the window stack checked after every navigation; Wi-Fi with the emulator's simulated Wi-Fi). CyberUI was tested on the same emulator at the Kindle Paperwhite's size and density (1072 × 1448, 300 dpi), in landscape, at 600 × 800 (167 dpi) and with text at 150 %, in dark and light mode, in greys and with colour rendering on, against seeded reading statistics, history, progress and collections. It only adds to KOReader's widgets at run time (no KOReader files are changed).

**Start-up never takes the plugin away.** KOReader silently leaves out a plugin whose `main.lua` fails while it loads, so every start-up step (fonts, theme, each module, each hook into KOReader's menus, title bars and catalog) is guarded: one that fails is logged to `crash.log` (`BookRaven: … failed`) and only that feature is missing. A module that cannot load is replaced by a stand-in, so its buttons show *This part of BookRaven could not load* instead of stopping KOReader; if the core modules themselves cannot load, *Settings → BookRaven* says *BookRaven could not start* instead of the plugin vanishing. If the cards view ever fails on a future KOReader, it switches itself back to the original list; if KOReader's top menu is ever built differently, the sun tab is simply left out.

## Files

| File | What it does |
|---|---|
| `main.lua` | Plugin entry: menus, the sun tab in the top menu, start screen, gesture actions, applies the theme while plugins load; guarded start-up |
| `br_home.lua` | The library home, and whether it is online (network and server) |
| `br_nav.lua` | Getting around: the raven and going back to the home, whole-screen refreshes, the raven and the magnifier in title bars |
| `br_wifi.lua` | Wi-Fi on and off in one tap (the quick settings and the home's top bar) |
| `br_search.lua` | Search: everything (device, library, Public Library), each shelf, the results grid |
| `br_quick.lua` | The quick settings panel: Wi-Fi, dark mode, brightness, warmth, text size, bold, font |
| `br_theme.lua` | The themes: fonts, the text settings (size, bold, font family) and title bars (ornament, HUD or classic) |
| `br_style.lua` | The rest of a theme: icons, check boxes, menu tabs, separators, dialogs, file browser rows |
| `br_widgets.lua` | Drawing pieces shared by the home and the catalog: tiles, labels, progress bars, cover shadows |
| `br_cards.lua` | Cards and shelf tiles for the OPDS browser |
| `br_gallery.lua` | Folder shelves: the gallery of a folder's books, *On this Kindle* (every book on the device) and the All shelves page |
| `br_covers.lua` | Cover download, shrinking and cache (catalog and local books) |
| `br_account.lua` | Account setup for the OPDS catalog and progress sync |
| `br_settings.lua` | Plugin settings (`bookraven` in KOReader's settings) |
| `cy_app.lua` | CyberUI: the Cyberdeck theme's library (it extends `br_home`): screens, status and bottom bars, back, paging |
| `cy_home.lua`, `cy_library.lua`, `cy_caches.lua`, `cy_log.lua`, `cy_diag.lua`, `cy_dossier.lua`, `cy_system.lua` | CyberUI's screens |
| `cy_deck.lua` | The deck: the quick settings with the Cyberdeck theme |
| `cy_ui.lua`, `cy_cover.lua` | CyberUI's drawing pieces: colour text, cut-corner boxes, buttons, tabs, bars, heartbeat, pager, popup; framed covers |
| `cy_palette.lua` | Colour schemes and light / dark mode, in colour or in greys |
| `cy_ascii.lua` | ASCII covers |
| `cy_data.lua` | What CyberUI shows: book status, folders, collections, reading telemetry, the device |
| `icons/cyberui/` | CyberUI's icons, tinted with the scheme's colours when drawn (cached in `koreader/cache/bookraven-cyberui`) |
| `fonts/` | Cormorant Garamond, Inter, Chakra Petch and Share Tech Mono, Latin subsets renamed BookRavenSerif / BookRavenSans / BookRavenCyber / BookRavenMono (SIL Open Font License, see the OFL files) |
| `icons/bookraven/`, `icons/cyberdeck/`, `icons/classic/` | Each theme's icon set, ornaments and home button (the raven; `icons/classic/br.raven.svg` is Classic's plain raven) |
| `icons/common/` | The plugin's own icons for every theme: quick settings, Wi-Fi on and off, suns, moon, bold, warmth, and the sun tab in KOReader's original look (each theme's folder has its own `br.tab.quick.svg`) |
| `art/bookraven/`, `art/cyberdeck/` | The home's header and the shelf vignettes: details of Gustave Doré's 1884 engravings for Poe's *The Raven* (public domain; scans from the Library of Congress) |
