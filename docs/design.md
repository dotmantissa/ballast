# Ballast design record

Seed: 27804758096702. Five independent choices were drawn before frontend implementation.

| Axis | Roll | Reason |
| :--- | :--- | :--- |
| Palette balance | Paper led | A clear ledger should be easy to read, with copper reserved for deliberate action. |
| Layout | Asymmetric grid | A generous working canvas sits beside a narrow capital and activity rail. |
| Type | Monospace with humanist sans | IBM Plex Mono treats figures like a ledger; Figtree makes the language approachable. |
| Motion | Stateful hover only | Motion communicates an available action or a changed state. Nothing drifts while someone reads evidence. |
| Structural device | Coverage waterline | One horizontal cut through the reserve visual shows the relationship between committed capital and room to cover another agent. |

Core colours are copper #cc904a, white #ffffff and black #000000. Light backgrounds use #ffffff with black text. Dark mode reverses the ink and paper. Copper carries focus, active navigation and the waterline. Font roles: Figtree 400 and 500 for prose, 600 and 700 for headings; IBM Plex Mono 400 and 500 for amounts, hashes and timestamps.

The application has a slim navigation column, an asymmetric main canvas and a contextual ledger rail. Its distinctive feature is the waterline reserve diagram, drawn with CSS and SVG rather than generated art. The logo is a vessel cross section with a compact ballast mass below its waterline; it also serves as the tab icon.

No tracked capital letter labels, decorative step numbers, ambient motion, repeated floating cards or dash separated marketing fragments. White space, strong rules and measured typography do most of the work. Forms expose real constraints before submission. Empty states remain empty and explain what to do next.
