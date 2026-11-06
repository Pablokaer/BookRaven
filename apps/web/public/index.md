# BookRaven

A free, self-hosted reader for ebooks, PDFs and comics, with reading progress synced across devices.

This server runs BookRaven. Each person signs in with their own account and keeps their own library;
nothing here is readable without an account, except what the server's readers publish to the Public
Library.

## What it reads

EPUB, MOBI, AZW3, FB2, PDF, and comics as CBZ, CBR, CB7 or CBT. Books are uploaded one by one, or a
whole Calibre library and Goodreads shelves are imported: title, author and cover are read from each
file, and duplicates are skipped.

## Features

- **One place in the book, everywhere.** The web reader, the Android app and KOReader on e-ink
  readers keep one position, down to the sentence. Positions are saved offline too, and the newest
  one wins.
- **Notes.** Highlights in four colors, notes and bookmarks, a pen for writing on PDFs, and a
  dictionary and translation for any selected word.
- **Sharing.** Share a book or a collection by link, publish it to the server's Public Library, or
  read together in a book club.
- **Public Library.** Public-domain classics from Project Gutenberg, Standard Ebooks and Wikisource,
  in eleven sections, with suggestions drawn from what you read.
- **Offline.** The library opens without a connection, and books you have opened keep working.
- **Other apps.** An OPDS catalog (`/opds`), KOReader progress sync (`/kosync`), an Android app
  installed from the server, and a KOReader plugin.

## Using it

- [Sign in](/login) or [create an account](/signup) (when the server allows sign-ups).
- The web app runs in the browser; there is no public API without an account.
- More for agents: [llms.txt](/llms.txt).

## Source

BookRaven is open source: <https://github.com/Pablokaer/BookRaven>. The README there explains how to
run your own server.
