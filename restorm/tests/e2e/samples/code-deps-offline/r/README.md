# R offline fixture — WebR-version coupling

Unlike the other languages here (whose offline fixtures are tiny hand-written
`restorm*dep` packages), the R link uses a **real** CRAN package binary,
`praise@1.0.0` — a zero-dependency, pure-R package. R's runtime is WebR, which
loads packages as R-compiled WASM binaries that cannot be hand-authored without
the emscripten R toolchain.

`praise_1.0.0.tgz` is downloaded from the WebR binary repository
(`repo.r-wasm.org/bin/emscripten/contrib/<R-major.minor>/`) for the **exact R
version the bundled WebR ships** — currently R 4.6.0 (WebR 0.6.x). `PACKAGES`
here is a one-paragraph offline copy of that repo's index, present so an offline
install resolves the package (and skips the network index fetch) with zero
registry traffic.

**Maintenance:** when WebR is upgraded to a new R minor, `library(praise)` in the
offline chain fails loudly at run time (the binary no longer matches the running
R). Re-fetch the matching binary + refresh `PACKAGES`:

```sh
R_CONTRIB=4.6   # = the bundled WebR's R major.minor (webR.versionR)
curl -sO "https://repo.r-wasm.org/bin/emscripten/contrib/$R_CONTRIB/praise_1.0.0.tgz"
# then copy praise's paragraph out of that contrib's PACKAGES into ./PACKAGES,
# and drop the new .tgz into ./praise@1.0.0/
```
