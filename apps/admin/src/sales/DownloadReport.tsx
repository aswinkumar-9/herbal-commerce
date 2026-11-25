import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { problemMessage } from '../api/problems';
import { saveFile } from '../api/save-file';
import { Button } from '../components/Button';
import { useToasts } from '../components/toast-context';
import { downloadSalesReport } from './sales-api';
import type { SalesFilter } from './sales-filters';
import type { Period } from './sales-periods';

// The report shown, as an Excel file (part 15D, ADR 0047): the same period
// and filters, with every day, every grouping and the register of each
// line. The API writes each download to the audit log.
export function DownloadReport({
  period,
  filter,
}: {
  period: Period;
  filter: SalesFilter;
}) {
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setProblem(null);
    try {
      const { file, fileName } = await downloadSalesReport(period, filter);
      saveFile(file, fileName);
      toasts.show(`Downloaded ${fileName}`);
    } catch (error) {
      setProblem(problemMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        icon={FileSpreadsheet}
        busy={busy}
        busyLabel="Preparing the file…"
        onClick={() => void download()}
      >
        Download as Excel
      </Button>
      {problem ? (
        <p role="alert" className="max-w-xs text-sm text-danger sm:text-right">
          The file could not be made. {problem}
        </p>
      ) : null}
    </div>
  );
}
