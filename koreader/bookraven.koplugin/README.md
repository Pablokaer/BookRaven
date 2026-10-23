# BookRaven for KOReader

A KOReader plugin that brings BookRaven to e-ink readers (Kindle, Kobo, PocketBook…):

- **Library home** (the start screen, like the Kindle's own home). It shows:
  - *Continue reading*: the last book you opened, with its cover, progress and page. Tap it to open the book.
  - *Shelves*: your BookRaven catalog's shelves as tiles illustrated with Gustave Doré's engravings for *The Raven*. Tap one to open it.
  - *New in your library*: covers from the catalog's recently added shelf, when the screen has room.

  The top bar has search, the file browser and KOReader's menu. Shelves and new books are saved on the device, so the home works offline and refreshes when KOReader is online. Turn it on with Settings → BookRaven → *Start with the BookRaven library*, or open it from *BookRaven library* in the file browser's ☰ menu. With that setting on, the home also comes back when you close a book.
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
- **Cards view for OPDS** (Settings → BookRaven → Catalog view, or the ☰ menu inside any catalog):
  - Books: pages that list books show a grid of cards with the cover, title and author instead of a text list. Sizes: 3 × 2, 3 × 3 or 4 × 3 per page.
  - Shelves: pages that list shelves show illustrated tiles.
  - Covers: they come from the catalog's OPDS image links. Each is downloaded once, shrunk and cached in `koreader/cache/bookraven-covers`, and the next page's covers are fetched ahead.
  - Books without a cover get a stand-in drawn by the theme.
  - The cards view works with any OPDS catalog that sends cover links, not only BookRaven.
- **One-step account setup** (Settings → BookRaven → Set up BookRaven account): enter the server, your email and an app password (BookRaven → Profile → Other apps). The plugin checks them, adds the "BookRaven" OPDS catalog, and points progress sync at `<server>/kosync` with the same login (Binary document matching).
- **BookRaven library** at the top of the file browser's ☰ menu, and as an action you can assign to a gesture (Settings → Taps and gestures → Gesture manager).

## Install

1. Copy the `bookraven.koplugin` folder into KOReader's `plugins` folder:
   - Kindle: `koreader/plugins/` on the Kindle drive.
   - Kobo: `.adds/koreader/plugins/`.
   - Other devices: the `plugins` folder inside KOReader's folder.
2. Restart KOReader.
3. Settings (gear) → BookRaven → Set up BookRaven account.
4. Optional: Theme → BookRaven or Cyberdeck, Start with the BookRaven library, Catalog view → Cards.

To remove it, disable it in Tools → More tools → Plugin management or delete the folder.

## Compatibility

Written and tested against KOReader v2026.07.2, the current stable release, at the Kindle Paperwhite's resolution in portrait and landscape. It only adds to KOReader's widgets at run time (no KOReader files are changed). If the cards view ever fails on a future KOReader, it switches itself back to the original list.

## Files

| File | What it does |
|---|---|
| `main.lua` | Plugin entry: menus, start screen, gesture action, applies the theme while plugins load |
| `br_home.lua` | The library home |
| `br_theme.lua` | The themes: fonts and title bars (ornament or HUD) |
| `br_style.lua` | The rest of a theme: icons, check boxes, menu tabs, separators, dialogs, file browser rows |
| `br_widgets.lua` | Drawing pieces shared by the home and the catalog: tiles, labels, progress bars, cover shadows |
| `br_cards.lua` | Cards and shelf tiles for the OPDS browser |
| `br_covers.lua` | Cover download, shrinking and cache (catalog and local books) |
| `br_account.lua` | Account setup for the OPDS catalog and progress sync |
| `br_settings.lua` | Plugin settings (`bookraven` in KOReader's settings) |
| `fonts/` | Cormorant Garamond, Inter, Chakra Petch and Share Tech Mono, Latin subsets renamed BookRavenSerif / BookRavenSans / BookRavenCyber / BookRavenMono (SIL Open Font License, see the OFL files) |
| `icons/bookraven/`, `icons/cyberdeck/` | Each theme's icon set, ornaments and home button |
| `art/bookraven/`, `art/cyberdeck/` | The home's header and the shelf vignettes: details of Gustave Doré's 1884 engravings for Poe's *The Raven* (public domain; scans from the Library of Congress) |
