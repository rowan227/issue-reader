# Economist reader

A private reading app for weekly issues exported from ProQuest. It contains no articles.

- Import a ProQuest export together with the issue's Table of Contents PDF; articles are matched to the real contents by section and page number.
- Issues are stored on each device for offline reading and synced through a private GitHub repository using a fine-grained access token entered in the app.
- Each issue can be downloaded as an EPUB.

PDF parsing uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0, see `vendor/PDFJS-LICENSE`).
