import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Upload } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';
import { clearAuthSession, getAccessToken } from '../../lib/auth';
import {
  type RegulationUploadResponse,
  setRegulationFaceRecognition,
  uploadRegulation,
} from '../../lib/api';

export function UploadRegulationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<RegulationUploadResponse | null>(null);
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
    setUploadResult(null);

    try {
      const response = await uploadRegulation(selectedFile, token);
      setUploadResult(response);
      setFaceRecognitionEnabled(response.summary.face_recognition_enabled);
    } catch (error) {
      if (isTokenError(error)) {
        handleTokenExpiry();
        return;
      }
      showWarning(error instanceof Error ? error.message : 'Failed to upload and extract regulation rules.');
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

    if (!uploadResult) {
      return;
    }

    const previousValue = faceRecognitionEnabled;
    setFaceRecognitionEnabled(enabled);
    setIsSavingFaceRecognition(true);

    try {
      const response = await setRegulationFaceRecognition(uploadResult.regulation.id, enabled, token);
      setFaceRecognitionEnabled(response.enabled);
      setUploadResult((current) =>
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
                    disabled={isUploading}
                  />
                  <span className="bg-[#d87545] text-white px-8 py-3 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors cursor-pointer inline-block">
                    {isUploading ? 'Uploading...' : 'Select File'}
                  </span>
                </label>

                {file && (
                  <p className="text-[#9e2a2b] mt-4">Selected: {file.name}</p>
                )}

                {isUploading && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#fde8d8] px-4 py-2 text-[#8b4a32]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Running LLM extraction and class mapping...</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="font-serif text-2xl text-[#9e2a2b]">
                Falcon Vision will monitor compliance using the extracted safety rules:
              </h2>

              {uploadResult ? (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl p-6 shadow-md border border-[#e0d5c7]">
                    <div className="space-y-3">
                      <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[#8b7355]">PPE items</p>
                        <p className="mt-2 text-sm text-[#8b4a32]">
                          {uploadResult.summary.ppe_items.length > 0 ? uploadResult.summary.ppe_items.join(', ') : 'None'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[#8b7355]">Fall Detection</p>
                        <p className="mt-2 text-sm text-[#8b4a32]">
                          {uploadResult.summary.fall_detection_active ? 'Active' : 'Not active'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-[#fff8f2] border border-[#eedfcd] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[#8b7355]">Fire detection</p>
                        <p className="mt-2 text-sm text-[#8b4a32]">
                          {uploadResult.summary.fire_smoke_detection_active ? 'Active' : 'Not active'}
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
                  </div>

                  <div className="flex justify-center">
                    <Link
                      to="/admin/monitoring"
                      className="inline-flex items-center justify-center rounded-full bg-[#d87545] px-8 py-3 text-white shadow-md transition-colors hover:bg-[#c42c1f]"
                    >
                      Start Monitoring
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-12 shadow-md border border-[#e0d5c7] text-center">
                  <p className="text-[#8b7355]">Upload a PDF to send it through the LLM extraction pipeline.</p>
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
