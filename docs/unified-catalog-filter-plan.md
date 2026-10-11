# Unified catalog filter

Scope: homepage Parameters, homepage Brand/model, Korea catalog desktop/mobile.

1. Preserve existing URL/filter identifiers and listing predicates. Add taxonomy-backed production periods to generation facet labels only; do not rewrite cars or naming records.
2. Share cascade dependency resets and option presentation. Keep facelift and hybrid descriptors where the existing key identifies them. Do not invent dates or resolve ambiguous paths by first match.
3. Use wrapping labels, separate production-period text, consistent gold selection, one-column lists in narrow containers. No nested mobile overlay.
4. Let the enclosing filter own Apply/Reset. Picker selection edits the draft, not the URL. Homepage uses one submit path for both entry points.
5. Verify generation mapping, dependent resets, typecheck/lint, and browser layouts at 320–430px and desktop. No database writes, deployment or unrelated changes.

Source: encar-taxonomy-english-labels.xlsx, snapshot 2026-10-01: 1851 of 1852 generation entries have production periods; Other has none. Runtime uses the existing versioned taxonomy JSON, not the spreadsheet.

## Implemented

- Shared cascade controls in homepage panels and mobile catalog Parameters; shared option row for shortcut pickers and desktop, wrapping names with a separate period line.
- Shared parent/descendant reset and facet-query rules. Parent choices do not retain stale descendant constraints.
- Existing grouped chassis identifiers remain grouped: their caption uses the complete taxonomy period across matching nodes. For example HG includes the hybrid branch through 2017. This is not a split into new filters. Unknown/ambiguous unmatched descriptors retain their existing labels.
- One enclosing Apply action; no picker Apply/Reset duplicates. Mobile uses the same inline picker inside its fullscreen filter, safe-area footer and focus/scroll management.
- No database writes or naming backfill.

## Verification

- Cascade label/reset/query tests, existing naming tests and catalog read/recovery tests passed. Changed files pass ESLint.
- Live local generation API retains keys/counts (Grandeur: 261; HG: 22).
- Browser: homepage at 320/390px, mobile catalog at 430px, desktop at 1440px. Generation names/periods wrap; homepage has one dialog and one Apply button. Mobile HG Apply retains generation=hg.
- Whole-project typecheck is blocked by pre-existing missing `note` types in untracked scripts/apply-encar-05fc8baf-power-research.ts:108,118. This unrelated script was not changed.
