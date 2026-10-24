# BookRaven for KOReader

A KOReader plugin that brings BookRaven to e-ink readers (Kindle, Kobo, PocketBook…):

- **Library home** (the start screen, like the Kindle's own home). It shows:
  - *Continue reading*: the last book you opened, with its cover, progress and page. Tap it to open the book.
  - *Shelves*: your BookRaven catalog's shelves as tiles illustrated with Gustave Doré's engravings for *The Raven*. Tap one to open it.
  - *Folder shelves*: tap **+ Add shelf** (on the Shelves heading, or the + tile) and long-press a folder on the device to choose it. The folder becomes a shelf with its name. Tapping it opens a gallery of its books as cards with their covers, like *My library*. Sub-folders appear as folder cards you can open; tap a book to read it. Long-press a folder shelf to remove it; the folder and its books stay on the device. When the home runs out of room, the last tile opens *All shelves*.
  - *New in your library*: covers from the catalog's recently added shelf, when the screen has room.

  The top bar has search (below), the quick settings (the chevron, below), the file browser and KOReader's menu. Shelves and new books are saved on the device, so the home works offline and refreshes when KOReader is online. Turn it on with Settings → BookRaven → *Start with the BookRaven library*, or open it from *BookRaven library* in the file browser's ☰ menu. With that setting on, the home also comes back when you close a book.
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
  - *Dark mode* (KOReader's night mode), *Bold text* and *Light* (the frontlight on or off);
  - *Brightness*: a slider between a small and a large sun (tap a sun for one step). *Warmth* too, on devices with a natural light;
  - *Text size* (A− / A+ from 80 % to 150 %; tap the value for 100 %) and *Font*: the theme's own, Noto Sans, Noto Serif, Inter, Cormorant or Chakra Petch.

  Text size, bold and font change the plugin's screens (home, shelves, cards, search) at once, and are saved (also in Settings → BookRaven → *Text*). With a theme on, KOReader's menus and dialogs take them at the next start: the panel then shows a *Restart* button. Brightness, warmth and dark mode are KOReader's own settings.

  Open it with a swipe down from the top edge of the plugin's screens (the home, folder shelves, *All shelves*, search results and the catalog's cards view; a swipe down lower on a shelf still closes it), the chevron on the home's top bar, Settings → BookRaven → *Quick settings…*, or any gesture you assign to *BookRaven quick settings* (Settings → Taps and gestures → Gesture manager), which also works in a book. Inside a book, KOReader's own swipe down from the top (its menu) is left alone. It is made for e-ink: no animation and one refresh per change. Close it with a tap below it, a swipe up, its close button or the handle at its bottom.
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
4. Optional: Theme → BookRaven, Cyberdeck or Classic e-reader, Start with the BookRaven library, Catalog view → Cards.

To remove it, disable it in Tools → More tools → Plugin management or delete the folder.

## Compatibility

Written and tested against KOReader v2026.07.2, the current stable release, at the Kindle Paperwhite's resolution in portrait and landscape; search, quick settings and the Classic e-reader theme were tested on KOReader v2026.07.1's emulator. It only adds to KOReader's widgets at run time (no KOReader files are changed). If the cards view ever fails on a future KOReader, it switches itself back to the original list.

## Files

| File | What it does |
|---|---|
| `main.lua` | Plugin entry: menus, start screen, gesture actions, applies the theme while plugins load |
| `br_home.lua` | The library home |
| `br_search.lua` | Search: everything (device, library, Public Library), each shelf, the results grid, the magnifier in title bars |
| `br_quick.lua` | The quick settings panel: dark mode, brightness, warmth, text size, bold, font |
| `br_theme.lua` | The themes: fonts, the text settings (size, bold, font family) and title bars (ornament, HUD or classic) |
| `br_style.lua` | The rest of a theme: icons, check boxes, menu tabs, separators, dialogs, file browser rows |
| `br_widgets.lua` | Drawing pieces shared by the home and the catalog: tiles, labels, progress bars, cover shadows |
| `br_cards.lua` | Cards and shelf tiles for the OPDS browser |
| `br_gallery.lua` | Folder shelves: the gallery of a folder's books, and the All shelves page |
| `br_covers.lua` | Cover download, shrinking and cache (catalog and local books) |
| `br_account.lua` | Account setup for the OPDS catalog and progress sync |
| `br_settings.lua` | Plugin settings (`bookraven` in KOReader's settings) |
| `fonts/` | Cormorant Garamond, Inter, Chakra Petch and Share Tech Mono, Latin subsets renamed BookRavenSerif / BookRavenSans / BookRavenCyber / BookRavenMono (SIL Open Font License, see the OFL files) |
| `icons/bookraven/`, `icons/cyberdeck/`, `icons/classic/` | Each theme's icon set, ornaments and home button |
| `icons/common/` | The plugin's own icons for every theme: quick settings, suns, moon, bold, warmth |
| `art/bookraven/`, `art/cyberdeck/` | The home's header and the shelf vignettes: details of Gustave Doré's 1884 engravings for Poe's *The Raven* (public domain; scans from the Library of Congress) |
