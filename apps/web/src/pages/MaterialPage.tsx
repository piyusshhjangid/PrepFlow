import type { ExamResponse, MaterialLimits, MaterialSummary } from '@prepflow/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api/endpoints';
import { ApiError } from '../api/http';
import { Alert, Button, Card, LinkButton } from '../components/ui';
import { formatBytes, formatMinutes, plural } from '../lib/format';
import { clearExamId, getExamId } from '../workspace';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; exam: ExamResponse; materials: MaterialSummary[]; limits: MaterialLimits }
  | { kind: 'error'; message: string };

type Notice = { kind: 'error' | 'warning' | 'success' | 'info'; message: string };

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function MaterialPage() {
  const examId = getExamId();
  if (!examId) return <Navigate to="/setup" replace />;
  return <MaterialScreen examId={examId} />;
}

function MaterialScreen({ examId }: { examId: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'text' | 'pdf' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [exam, list] = await Promise.all([api.getExam(examId), api.listMaterials(examId)]);
      setState({ kind: 'ready', exam, materials: list.materials, limits: list.limits });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EXAM_NOT_FOUND') {
        clearExamId();
        setMissing(true);
        return;
      }
      setState({ kind: 'error', message: messageOf(error) });
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) return <Navigate to="/setup" replace />;
  if (state.kind === 'loading')
    return <p className="text-sm text-slate-600">Loading your material…</p>;
  if (state.kind === 'error') {
    return (
      <Card title="We couldn’t load your material">
        <p className="mb-4 text-sm text-slate-600">{state.message}</p>
        <Button onClick={() => void load()}>Try again</Button>
      </Card>
    );
  }

  const { exam, materials, limits } = state;

  function showResult(result: { material: MaterialSummary; duplicate: boolean }) {
    if (result.duplicate) {
      setNotice({ kind: 'info', message: 'You’ve already added this. Nothing was changed.' });
      return;
    }
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, materials: [...current.materials, result.material] }
        : current,
    );
    const { pageCount, lowTextPageCount } = result.material;
    if (lowTextPageCount && pageCount) {
      setNotice({
        kind: 'warning',
        message: `Added, but ${plural(lowTextPageCount, 'PDF page')} of ${pageCount} had little or no selectable text, so material on those pages may be missing.`,
      });
    } else {
      setNotice({ kind: 'success', message: 'Added to your material.' });
    }
  }

  async function addText() {
    if (text.trim() === '') {
      setNotice({ kind: 'error', message: 'Paste some of your syllabus or notes first.' });
      return;
    }
    if (text.length > limits.maxChars) {
      setNotice({
        kind: 'error',
        message: `That’s more text than PrepFlow can process at once (limit: ${limits.maxChars.toLocaleString('en-US')} characters). Split it into smaller parts and add them separately.`,
      });
      return;
    }
    setBusy('text');
    setNotice(null);
    try {
      showResult(await api.addText(examId, text));
      setText('');
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) }); // the pasted text stays in the box
    } finally {
      setBusy(null);
    }
  }

  function chooseFile(chosen: File | null) {
    setNotice(null);
    if (!chosen) {
      setFile(null);
      return;
    }
    if (!isPdf(chosen)) {
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setNotice({
        kind: 'error',
        message: 'Only PDF files can be uploaded. For other formats, paste the text instead.',
      });
      return;
    }
    if (chosen.size > limits.maxPdfBytes) {
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setNotice({
        kind: 'error',
        message: `That PDF is ${formatBytes(chosen.size)}, which is larger than the ${formatBytes(limits.maxPdfBytes)} limit. Upload fewer pages at a time, or paste the text instead.`,
      });
      return;
    }
    setFile(chosen);
  }

  async function uploadPdf() {
    if (!file) {
      setNotice({ kind: 'error', message: 'Choose a PDF file to upload.' });
      return;
    }
    setBusy('pdf');
    setNotice(null);
    try {
      showResult(await api.uploadPdf(examId, file));
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(material: MaterialSummary) {
    setConfirmingId(null);
    setNotice(null);
    try {
      await api.deleteMaterial(material.id);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'MATERIAL_NOT_FOUND')) {
        setNotice({ kind: 'error', message: messageOf(error) });
        return;
      }
    }
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, materials: current.materials.filter((m) => m.id !== material.id) }
        : current,
    );
  }

  const { daysUntilExam, studyDays, availableMinutes } = exam.availability;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add your study material</h1>
        <p className="mt-1 text-sm text-slate-600">
          {exam.name} · {exam.examDate} · {plural(daysUntilExam, 'day')} to go ·{' '}
          {studyDays > 0
            ? `about ${formatMinutes(availableMinutes)} of study time`
            : 'no study days available'}{' '}
          ·{' '}
          <Link to="/setup" className="font-medium text-indigo-700 underline">
            Edit setup
          </Link>
        </p>
      </div>

      {notice && <Alert kind={notice.kind}>{notice.message}</Alert>}

      <Card title="Paste text">
        <label htmlFor="paste" className="sr-only">
          Syllabus or notes
        </label>
        <textarea
          id="paste"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your syllabus or notes here"
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {text.length.toLocaleString('en-US')} / {limits.maxChars.toLocaleString('en-US')}{' '}
            characters
          </span>
          <Button onClick={() => void addText()} busy={busy === 'text'} disabled={busy !== null}>
            {busy === 'text' ? 'Adding…' : 'Add pasted text'}
          </Button>
        </div>
      </Card>

      <Card title="Upload a PDF">
        <label htmlFor="pdf" className="mb-1 block text-sm font-medium">
          Choose a PDF
        </label>
        <input
          id="pdf"
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
        />
        <p className="mt-2 text-xs text-slate-500">
          Up to {formatBytes(limits.maxPdfBytes)} and {plural(limits.maxPdfPages, 'page')}. The PDF
          needs selectable text; scanned images aren’t supported yet. Your file is read once and not
          stored.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-700">
            {file ? `${file.name} (${formatBytes(file.size)})` : 'No file chosen'}
          </span>
          <Button
            onClick={() => void uploadPdf()}
            busy={busy === 'pdf'}
            disabled={busy !== null || !file}
          >
            {busy === 'pdf' ? 'Reading PDF…' : 'Upload PDF'}
          </Button>
        </div>
      </Card>

      <Card title={`Your material (${materials.length} of ${limits.maxMaterialsPerExam})`}>
        {materials.length === 0 ? (
          <p className="text-sm text-slate-600">
            Upload your syllabus or notes to start building your plan.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {materials.map((material) => (
              <li
                key={material.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{material.filename ?? 'Pasted text'}</p>
                  <p className="text-xs text-slate-500">
                    {material.sourceType === 'PDF' && material.pageCount !== null
                      ? `PDF · ${plural(material.pageCount, 'PDF page')} · `
                      : 'Pasted text · '}
                    {plural(material.charCount, 'character')}
                    {material.lowTextPageCount ? (
                      <span className="text-amber-700">
                        {' '}
                        · {plural(material.lowTextPageCount, 'page')} with little or no text
                      </span>
                    ) : null}
                  </p>
                </div>
                {confirmingId === material.id ? (
                  <div className="flex gap-2">
                    <Button variant="danger" onClick={() => void remove(material)}>
                      Confirm remove
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirmingId(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmingId(material.id)}>
                    Remove
                    <span className="sr-only"> {material.filename ?? 'pasted text'}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {materials.length > 0 && (
        <div className="flex justify-end">
          <LinkButton to="/analysis">Analyze my material</LinkButton>
        </div>
      )}

      <div className="rounded-lg border border-dashed border-slate-300 p-4">
        <Button disabled aria-describedby="analyze-note">
          Analyze my material
        </Button>
        <p id="analyze-note" className="mt-2 text-sm text-slate-600">
          Analysis arrives in the next step of the build. Your material is saved and will be ready
          for it.
        </p>
      </div>
    </div>
  );
}
