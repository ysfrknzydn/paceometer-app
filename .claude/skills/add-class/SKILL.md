---
name: add-class
description: Add or modify a class in this codebase following its OOP/UML convention — implementation, both .puml diagrams, and a docs/CLAUDE.md entry all land in the same change, not as a follow-up. Use whenever a change introduces a new class, removes one, or changes what a class owns/depends on.
---

This project holds new features to a standing rule: **new features must be
proper classes, and `docs/diagrams/*.puml` must be updated in the same
change, not after.** This skill is the checklist for doing that correctly,
based on the existing module layout (see `docs/CLAUDE.md`'s Architecture
section — one class/module per concern under `js/`, `js/math/` reserved for
pure functions with no classes).

## Steps

For the class described in $ARGUMENTS:

1. **Implement it** in the appropriate `js/` subdirectory (`js/ui/`,
   `js/gps/`, `js/speedLimit/`, `js/trip/`, `js/feedback/`, `js/dev/`, or a
   new subdirectory if it's a genuinely new concern). Follow the existing
   style in that directory: a `/** or //-style header comment explaining the
   *why*, not the what; private fields prefixed `_`; DOM refs looked up once
   in the constructor if it's a UI class.

2. **Wire it up** wherever it's consumed — usually `js/app.js` (the
   composition root) or another class's constructor, matching how
   `VehiclePicker` owns four `SearchableSelect` instances as an example of a
   class owning several instances of another.

3. **Update `docs/diagrams/class-diagram.puml`**:
   - Add a `class Foo { - field \n -- \n + method() }` block, matching the
     terse attribute/method style already there (implementation detail
     fields only, not every private helper).
   - Add its ownership/dependency arrow(s) near the bottom, matching the
     existing `"1" *-down- "1"` (owns, one-to-one), `"1" *-down- "N"` (owns
     many), or `..>` (uses/dashed) conventions.

4. **Update `docs/diagrams/package-diagram.puml`**: add the class inside its
   `js/<dir>` package block, and add a `pkgA --> pkgB` or `classA ..> classB`
   arrow for any new import relationship.

5. **Regenerate both PDFs** — do not leave stale PDFs committed alongside
   changed `.puml` sources:
   ```
   cd docs/diagrams && plantuml -tpdf class-diagram.puml package-diagram.puml
   ```
   Requires `plantuml` + `graphviz` (`brew install plantuml graphviz` if
   missing — check with `which plantuml dot` first).

6. **Add a dated paragraph to `docs/CLAUDE.md`**, in the Architecture
   section, near the feature area it relates to (not appended at the end).
   Match the file's existing density: explain *why* the class exists and
   *why* it's shaped the way it is (a design tradeoff, a bug it fixes, a
   constraint it works around) — not a restatement of what the code
   obviously does. Look at the entries for `VehiclePicker` or
   `SegmentedSetting` as the template for length/tone.

7. **Syntax-check every touched JS file** (this project has no bundler, so
   this is the only automated check before a manual browser verification):
   ```
   node --input-type=module --check < path/to/file.js
   ```

8. **If the class has DOM-visible behavior**, verify it in a real browser —
   invoke the `verify-ui` skill rather than trusting the diff by eye.

## Common mistakes to avoid

- Adding the class to `class-diagram.puml` but forgetting
  `package-diagram.puml` (or vice versa) — both must move together, and
  `uml-sync-checker` will flag a mismatch if you skip one.
- Editing the `.puml` source without regenerating the `.pdf` — check
  `git status` shows both changed before considering the diagram work done.
- Writing a docs/CLAUDE.md paragraph that just describes *what* the class
  does (redundant with the code) instead of *why* it's shaped that way.
