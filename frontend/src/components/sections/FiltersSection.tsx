// The filters section of the left column.
//
// The section holds the whole constructor of the selection: the field of the
// query, the tags of the vault and the saved filters. It answers the question
// "which notes do I want to see right now?".
import { FilterPanel } from '../FilterPanel';

export function FiltersSection() {
  return (
    <section class="column-section" aria-label="Filters">
      <header class="column-header section-header">
        <span class="section-header-title">Filters</span>
      </header>
      <div class="column-body">
        <FilterPanel />
      </div>
    </section>
  );
}
