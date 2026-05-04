import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Upload } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';
import { clearAuthSession, getAccessToken } from '../../lib/auth';
import {
  cancelRegulationExtraction,
  deleteRegulation,
  extractRegulation,
  getCurrentRegulation,
  type RegulationCurrentResponse,
  type RegulationUploadResponse,
  setRegulationFaceRecognition,
  uploadRegulation,
} from '../../lib/api';

export function UploadRegulationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isStoppingExtraction, setIsStoppingExtraction] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentRegulation, setCurrentRegulation] = useState<RegulationCurrentResponse | null>(null);
  const [faceRecognitionEnabled, setFaceRecognitionEnabled] = useState(false);
  const [isSavingFaceRecognition, setIsSavingFaceRecognition] = useState(false);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });

  const showWarning = (message: string) => {
    setModalState({
      isOpen: true,
      title: 'Warning!',
      message,
    });
  };

  const isTokenError = (error: unknown) =>
    error instanceof Error && /invalid or expired token/i.test(error.message);

  const handleTokenExpiry = () => {
    clearAuthSession();
    setModalState({
      isOpen: true,
      title: 'Session Expired',
      message: 'Your login session expired. Please log in again.',
    });
    window.setTimeout(() => {
      window.location.href = '/login';
    }, 300);
  };

  const applyCurrentRegulation = (response: RegulationCurrentResponse | RegulationUploadResponse | null) => {
    if (!response) {
      setCurrentRegulation(null);
      setFaceRecognitionEnabled(false);
      return;
    }

    const normalized: RegulationCurrentResponse = {
      regulation: response.regulation,
      extracted_rules: response.extracted_rules,
      summary: response.summary,
    };

    setCurrentRegulation(normalized);
    setFaceRecognitionEnabled(normalized.summary.face_recognition_enabled);
  };

  const loadCurrentRegulation = async ({ silent = false }: { silent?: boolean } = {}) => {
    const token = getAccessToken();
    if (!token) {
      setIsLoadingCurrent(false);
      return;
    }

    if (!silent) {
      setIsLoadingCurrent(true);
    }
    try {
      const response = await getCurrentRegulation(token);
      applyCurrentRegulation(response);
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }
      applyCurrentRegulation(null);
    } finally {
      if (!silent) {
        setIsLoadingCurrent(false);
      }
    }
  };

  useEffect(() => {
    void loadCurrentRegulation();
  }, []);

  const validateFile = (selectedFile: File | undefined) => {
    if (!selectedFile) {
      return null;
    }

    const isPdf = selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showWarning('Unsupported file type. Please upload a PDF file.');
      return null;
    }

    return selectedFile;
  };

  const submitRegulation = async (selectedFile: File) => {
    const token = getAccessToken();
    if (!token) {
      showWarning('Please log in again before uploading a regulation.');
      return;
    }

    setIsUploading(true);

    try {
      const response = await uploadRegulation(selectedFile, token);
      applyCurrentRegulation(response);
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }
      showWarning(error instanceof Error ? error.message : 'Failed to upload the regulation PDF.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = validateFile(event.target.files?.[0]);
    if (!selectedFile) {
      return;
    }

    setFile(selectedFile);
    await submitRegulation(selectedFile);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    const droppedFile = validateFile(event.dataTransfer.files?.[0]);
    if (!droppedFile) {
      return;
    }

    setFile(droppedFile);
    await submitRegulation(droppedFile);
  };

  const handleFaceRecognitionChange = async (enabled: boolean) => {
    const token = getAccessToken();
    if (!token) {
      showWarning('Please log in again before updating face recognition.');
      return;
    }

    if (!currentRegulation?.regulation) {
      return;
    }

    const previousValue = faceRecognitionEnabled;
    setFaceRecognitionEnabled(enabled);
    setIsSavingFaceRecognition(true);

    try {
      const response = await setRegulationFaceRecognition(currentRegulation.regulation.id, enabled, token);
      setFaceRecognitionEnabled(response.enabled);
      setCurrentRegulation((current) =>
        current
          ? {
              ...current,
              summary: {
                ...current.summary,
                face_recognition_enabled: response.enabled,
              },
            }
          : current,
      );
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }
      setFaceRecognitionEnabled(previousValue);
      showWarning(error instanceof Error ? error.message : 'Failed to update face recognition setting.');
    } finally {
      setIsSavingFaceRecognition(false);
    }
  };

  const handleExtract = async () => {
    const token = getAccessToken();
    if (!token || !currentRegulation?.regulation) {
      showWarning('Please log in again before extracting regulation rules.');
      return;
    }

    setIsExtracting(true);
    try {
      const response = await extractRegulation(currentRegulation.regulation.id, token);
      applyCurrentRegulation(response);
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }
      showWarning(error instanceof Error ? error.message : 'Failed to extract regulation rules.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStopExtracting = async () => {
    const token = getAccessToken();
    if (!token || !currentRegulation?.regulation) {
      return;
    }

    setIsStoppingExtraction(true);
    try {
      const response = await cancelRegulationExtraction(currentRegulation.regulation.id, token);
      applyCurrentRegulation(response);
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }
      showWarning(error instanceof Error ? error.message : 'Failed to stop extraction.');
    } finally {
      setIsStoppingExtraction(false);
      setIsExtracting(false);
    }
  };

  const handleDelete = async () => {
    const token = getAccessToken();
    if (!token || !currentRegulation?.regulation) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteRegulation(currentRegulation.regulation.id, token);
      setFile(null);
      applyCurrentRegulation(null);
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }
      showWarning(error instanceof Error ? error.message : 'Failed to delete the uploaded regulation PDF.');
    } finally {
      setIsDeleting(false);
    }
  };

  const regulation = currentRegulation?.regulation ?? null;
  const extractionStatus = regulation?.extraction.status ?? 'not_started';
  const isExtractionRunning = isExtracting || extractionStatus === 'pending' || extractionStatus === 'processing';
  const isExtractionStopping = isStoppingExtraction || extractionStatus === 'cancelling';
  const isExtractionBusy = isExtractionRunning || isExtractionStopping;
  const showExtractionStatus =
    extractionStatus !== 'not_started' &&
    extractionStatus !== 'pending' &&
    extractionStatus !== 'cancelling' &&
    !isExtractionRunning;
  const hasExtractedRules = (currentRegulation?.summary.total_rules ?? 0) > 0;
  const canStartMonitoring = hasExtractedRules;
  const uploadedFileName = file?.name ?? regulation?.file.original_filename ?? null;

  useEffect(() => {
    if (!regulation || !['pending', 'processing', 'cancelling'].includes(extractionStatus)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadCurrentRegulation({ silent: true });
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [regulation?.id, extractionStatus]);

  return (
    <div className="min-h-screen flex flex-col bg-[#fde8d8]">
      <Navigation isAdmin={true} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-serif text-4xl text-[#9e2a2b] mb-8">Upload Regulation</h1>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div
                onDrop={handleDrop}
                onDragOver={(event) => event.preventDefault()}
                className="bg-white rounded-3xl border-2 border-dashed border-[#d87545] p-12 text-center hover:border-[#c42c1f] transition-colors"
              >
                <Upload className="w-16 h-16 text-[#d87545] mx-auto mb-4" />
                <h3 className="font-serif text-xl text-[#9e2a2b] mb-2">Drag and drop the regulation PDF here</h3>
                <p className="text-[#8b7355] mb-2">Supported format: `.pdf`</p>
                <label className="inline-block mt-4">
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={isUploading || isExtractionBusy || isDeleting}
                  />
                  <span className="bg-[#d87545] text-white px-8 py-3 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors cursor-pointer inline-block">
                    {isUploading ? 'Uploading...' : 'Select File'}
                  </span>
                </label>

                {uploadedFileName && (
                  <p className="text-[#9e2a2b] mt-4">Saved PDF: {uploadedFileName}</p>
                )}

                {isUploading && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#fde8d8] px-4 py-2 text-[#8b4a32]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Uploading regulation PDF...</span>
                  </div>
                )}

                {regulation && (
                  <div className="mt-6 rounded-2xl border border-[#eedfcd] bg-[#fff8f2] p-4 text-left">
                    <p className="text-sm text-[#8b7355]">Current regulation</p>
                    <p className="mt-1 font-medium text-[#8b4a32]">{regulation.title}</p>
                    <p className="mt-1 text-sm text-[#8b7355]">{regulation.file.original_filename}</p>
                    {isExtractionBusy ? (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#fde8d8] px-4 py-2 text-[#8b4a32]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">
                          {isExtractionStopping
                            ? 'Stopping extraction...'
                            : extractionStatus === 'pending'
                              ? 'Queueing extraction...'
                              : 'Extracting regulation rules...'}
                        </span>
                      </div>
                    ) : null}
                    {showExtractionStatus ? (
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#8b7355]">
                        Extraction status: {regulation.extraction.status.replace(/_/g, ' ')}
                      </p>
                    ) : null}
                    {regulation.extraction.error_message && (
                      <p className="mt-2 text-sm text-[#9e2a2b]">{regulation.extraction.error_message}</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void (isExtractionBusy ? handleStopExtracting() : handleExtract())}
                        disabled={isDeleting || isExtractionStopping}
                        className="rounded-full bg-[#d87545] px-5 py-2.5 text-white shadow-md transition-colors hover:bg-[#c42c1f] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="inline-flex items-center gap-2">
                          {isExtractionStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {isExtractionStopping
                            ? 'Stopping...'
                            : isExtractionBusy
                              ? 'Stop Extracting'
                              : hasExtractedRules
                                ? 'Extract Again'
                                : 'Start Extracting'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete()}
                        disabled={isDeleting || isExtractionBusy}
                        className="rounded-full border border-[#d4bfa7] bg-white px-5 py-2.5 text-[#8b4a32] shadow-sm transition-colors hover:bg-[#fff3e6] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isDeleting ? 'Deleting...' : 'Delete PDF'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {hasExtractedRules ? (
                <h2 className="font-serif text-2xl text-[#9e2a2b]">
                  Falcon Vision will monitor compliance using the extracted safety rules:
                </h2>
              ) : null}

              {isLoadingCurrent ? (
                <div className="bg-white rounded-2xl p-12 shadow-md border border-[#e0d5c7] text-center">
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#fde8d8] px-4 py-2 text-[#8b4a32]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading saved regulation...</span>
                  </div>
                </div>
              ) : regulation ? (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl p-6 shadow-md border border-[#e0d5c7]">
                    {!hasExtractedRules ? (
                      ['pending', 'processing', 'cancelling'].includes(extractionStatus) ? (
                        <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4 text-sm text-[#8b4a32]">
                          <div className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>
                              {extractionStatus === 'cancelling'
                                ? 'Stopping extraction...'
                                : 'Extraction is in progress. You can stop extracting or wait for the rules to finish processing.'}
                            </span>
                          </div>
                        </div>
                      ) : null
                    ) : null}
                    {hasExtractedRules ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-[#8b7355]">PPE items</p>
                          <p className="mt-2 text-sm text-[#8b4a32]">
                            {currentRegulation.summary.ppe_items.length > 0 ? currentRegulation.summary.ppe_items.join(', ') : 'None'}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-[#8b7355]">Fall Detection</p>
                          <p className="mt-2 text-sm text-[#8b4a32]">
                            {currentRegulation.summary.fall_detection_active ? 'Active' : 'Not active'}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-[#8b7355]">Fire detection</p>
                          <p className="mt-2 text-sm text-[#8b4a32]">
                            {currentRegulation.summary.fire_smoke_detection_active ? 'Active' : 'Not active'}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-[#8b7355]">Face recognition</p>
                          <label className="mt-3 inline-flex items-center gap-3 text-sm text-[#8b4a32]">
                            <input
                              type="checkbox"
                              checked={faceRecognitionEnabled}
                              disabled={isSavingFaceRecognition}
                              onChange={(event) => void handleFaceRecognitionChange(event.target.checked)}
                              className="h-4 w-4 rounded border-[#d4bfa7] text-[#d87545] focus:ring-[#d87545]"
                            />
                            <span>{isSavingFaceRecognition ? 'Saving...' : 'Enable face recognition'}</span>
                          </label>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {canStartMonitoring ? (
                    <div className="flex justify-center">
                      <Link
                        to="/admin/monitoring"
                        className="inline-flex items-center justify-center rounded-full bg-[#d87545] px-8 py-3 text-white shadow-md transition-colors hover:bg-[#c42c1f]"
                      >
                        Start Monitoring
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-12 shadow-md border border-[#e0d5c7] text-center">
                  <p className="text-[#8b7355]">Upload a PDF to save it for this admin, then choose when to extract or delete it.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <WarningModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ ...modalState, isOpen: false })}
        title={modalState.title}
        message={modalState.message}
      />

      <Footer />
    </div>
  );
}
