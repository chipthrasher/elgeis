# DESIGN QUESTIONS

Open questions for [DESIGN.md](DESIGN.md). As each one is answered, fold the decision into DESIGN.md and remove it from here.

Data size isn't a constraint: the political layer is roughly 100–400 KB of JSON (smaller gzipped), so every layer can ship to the browser as static JSON.

- **What is the layers remote?** The backend's layers repo (the `repo` volume) holds the layer folders at its root, starting from a copy of `layers/` in this repo. Should it push to this repo's `layers/` folder instead, or to a repo of its own?
