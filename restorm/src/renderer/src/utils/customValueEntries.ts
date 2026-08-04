import type { CustomValueEntry } from '../../../shared/types/collections'

/**
 * Whether a custom-value entry can be offered to the user as a choice.
 *
 * Two things disqualify one. A disabled entry is out by definition. So is an
 * entry with no label: it would render as a blank, indistinguishable line that
 * picks an empty value — in a dropdown, in a multi-select, and as a stop in the
 * switch-node cycle, where an unnamed case is worse still.
 *
 * A label-less entry is a shape the editor legitimately produces: the entries
 * table keeps one empty row as a typing affordance, and a row left blank
 * alongside filled ones is stored rather than yanked out from under the user
 * mid-edit. Every place that turns entries into choices therefore has to agree
 * on what counts as one, which is why this lives here rather than beside any
 * single caller.
 *
 * Note the asymmetry with RESOLUTION: looking an entry up by its stored label
 * (the dispatch resolver, the scenario resolvers) is not offering a choice, so
 * those paths deliberately don't use this — a value that already names a label
 * still resolves to it.
 */
export function isPickableEntry(entry: Pick<CustomValueEntry, 'label' | 'enabled'>): boolean {
  return entry.enabled !== false && entry.label.trim() !== ''
}
