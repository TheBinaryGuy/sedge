---
title: Memory
description: What sedge remembers between conversations, and how it keeps that accurate.
---

sedge's memory is a folder of files: `~/.sedge/memory`. It follows
[The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory).

## What's loaded, and what isn't

- **`MEMORY.md`** is loaded into every run, only its first 200 lines (or 25 KB). It's an index:
  what sedge knows and where to find it, plus anything it needs every time (your standing
  instructions, current goals). Keeping it short keeps it cheap and keeps it followed.
- **Everything else** in the folder is organized by sedge itself and read when a task calls for
  it.

## What it writes down

sedge is told what memory is for, not a fixed scheme for using it. It writes when you ask it to
remember something, or when something is clearly worth keeping: what it couldn't look up again,
rules it verified (and how it knows), your preferences, and traps it ran into. It doesn't copy
things it can read off the world anyway.

You can tell it directly: "remember that I deploy on Fridays", "forget the old staging URL".

## Recall

Every conversation is kept. The `recall` tool searches all of them, newest first: what you said,
what sedge answered, what tools returned. It's how sedge looks back without having written
everything down.

## Dreaming

Notes are written in the moment, and some turn out wrong or go stale. Every night at 03:30 (your
time) sedge **dreams**: in its own `dream` conversation, nobody waiting, it reads back over recent
conversations with `recall` and checks its memory against them. It:

- corrects notes that turned out wrong or out of date;
- merges duplicates and deletes what no longer matters;
- records what it learned and didn't write down;
- keeps `MEMORY.md` small, moving details into other files and leaving a link.

If little happened, it changes little. It doesn't message you.

To turn dreaming off, set `"dreaming": false` in `~/.sedge/config.json` and restart the daemon.

## Editing it yourself

It's your folder. Edit any file; sedge reads it fresh on the next run. In the TUI you can ask the
agent to change what the daemon remembers.
