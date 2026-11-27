import { Table2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '../components/Button';

export interface ChartRow {
  key: string;
  // The first cell names the row.
  cells: string[];
}

// A chart's numbers as a table, a button away (part 15D, ADR 0047): every
// value the drawing shows, for anyone who can't or would rather not read
// it. The first column names each row; the others are figures.
export function ChartTable({
  label,
  headers,
  rows,
}: {
  // The table's caption: what the chart shows.
  label: string;
  headers: string[];
  rows: ChartRow[];
}) {
  const [open, setOpen] = useState(false);
  const tableId = useId();
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={Table2}
        aria-expanded={open}
        aria-controls={tableId}
        onClick={() => setOpen((shown) => !shown)}
        className="mt-2"
      >
        {open ? 'Hide the table' : 'Show as a table'}
      </Button>
      <div
        id={tableId}
        hidden={!open}
        className="mt-2 overflow-x-auto rounded-lg border border-line"
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="bg-surface-muted text-xs text-ink-muted">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={header}
                  scope="col"
                  className={`px-3 py-1.5 font-medium ${i > 0 ? 'text-right' : ''}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-3 py-1.5 font-medium">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
