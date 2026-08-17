# Prototypes

## Rules

A prototype here is a prop. It exists to be looked at and thrown away.

- **One self-contained file.** Inline CSS and JS. No build step, no bundler, no framework install, no package added to the project.
- **No network.** No CDN links, no remote fonts, no API calls. It must render correctly offline and after the session ends.
- **Fake data, obviously fake.** Realistic in shape, clearly not real in content. Enough rows to show what a full state looks like — three rows hides every layout problem that matters.
- **No wiring.** It does not import from the real app, does not touch real routes, state, or storage, and nothing in the real app imports it. Interactions are faked in place if they need to be shown at all.
- **Nothing real breaks if it is deleted.** That is the test for all of the above.

## Location and naming

Repo-root `strawman/`, named `YYYY-MM-DD-<topic>.html`. Everything the pass produces goes in that one folder so cleanup is a single delete.

Do not edit `.gitignore` — say the folder is throwaway and leave the decision to the user.

Start every file with:

```html
<!-- Throwaway prototype. Fake data, no wiring. Delete freely. -->
```

Print the path and how to open it (`open strawman/2026-07-29-toolbar.html`, or the platform equivalent). A prototype the user has to go looking for does not get looked at.

## Side-by-side layout

For a visual `DIVERGE`, all options go in **one** file, laid out so they can be compared without scrolling between them — a row or grid of panels, each labelled with the option's name and number from its card.

Separate files force sequential viewing, and sequential viewing produces "they're all fine". The comparison is the instrument.

Keep the panels honest: same fake data in each, same viewport width, no option given more space than the others.

## Iterating

Edit the same file at the same path. Do not produce `-v2`, `-final`, or a new dated file for each round — the user loses track of which one they are looking at, and stale versions get reacted to.

Exception: the user explicitly asks to keep the old one for comparison. Then say which is which, in the file and in chat.

## When HTML is the wrong medium

The medium follows the subject. A CLI's output is mocked as literal text in the chat. A data shape is mocked as a JSON blob. An API is mocked as a request and response pair. Reach for HTML when the thing being judged is visual; do not build a web page to show something that is three lines of text.
