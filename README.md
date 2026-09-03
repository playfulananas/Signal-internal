# SIGNAL — Digital Prototype

Multiplayer WWII tactical card game. Vanilla JS + Firebase Realtime Database.

This repository is the full internal development version. The client-testing repository
`Shonetronic/Signal` and its GitHub Pages deployment are separate and must not be updated from
this branch without explicit approval.

## Run locally

```sh
npm run dev
```

Then open `http://localhost:3000` in a browser.

## Verify changes

```sh
npm test
npm run test:browser
```

The browser command expects `npm run dev` to be running in another terminal. GitHub Actions also
runs both checks on every push and pull request.

## Play online (two devices)

1. One player clicks **Create Game**, shares the 6-letter code.
2. Other player clicks **Join Game**, enters the code.
3. Both pick decks and map, then play.

## Architecture

- See `docs/INTERNAL_STABILITY_CHANGES.md` for a non-technical explanation of the current safety
  and stability work.
- See `DEVNOTES.md` for a quick developer orientation.
- See `ARCHITECTURE.md` for the detailed technical structure.
- See `STATUS.md` for current implementation status.
