# Karmameter API

## Environment variables

Copy `.env.example` to `.env` and fill in real values:

- `CONNECTION_STRING` (required) - MongoDB Atlas connection string.
- `GOOGLE_MAPS_API_KEY` (required) - server-side Google Maps Platform key,
  used for Places Nearby Search, Place Details, Place Photo (proxied via
  `/places/photo` so the browser never needs a Places-enabled key), and
  Elevation. Keep this separate from the browser-restricted Maps JavaScript
  API key used in the frontend - an HTTP-referrer-restricted key cannot be
  used for these server-to-server calls.
- `PORT` (optional) - defaults to 3000.

## npm scripts

- `npm install` - installs dependencies and applies the `patches/` via
  `patch-package` (see below).
- `npm start` - starts the server on `PORT` (default 3000).

## The restify patch

`node_modules` isn't committed, so a fix to `restify@6.3.4` is captured as
`patches/restify+6.3.4.patch` and applied automatically via the `postinstall`
script. Without it, every `PUT`/`POST` request returns HTTP 444 (nginx's
"closed without response" code) even on success - see `NOTES.md` for why.
