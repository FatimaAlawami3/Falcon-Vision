import { useEffect, useRef, useState } from 'react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import {
  Camera,
  Play,
  Save,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Square,
  Users,
  X,
} from 'lucide-react';
import { WarningModal } from '../../components/WarningModal';
import { WarningConfirmModal } from '../../components/WarningConfirmModal';
import { getAccessToken } from '../../lib/auth';
import {
  type FaceRecognitionResponse,
  recognizeEmployeeFace,
} from '../../lib/api';
import liveFeedImage from '../../../assets/images/live-feed.png';
import workerDetectedImage from '../../../assets/images/worker-detected.png';

async function captureVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (!width || !height) {
    return null;
  }

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
  });
}

function formatScore(score?: number | null) {
  return typeof score === 'number' ? score.toFixed(3) : '--';
}

function formatRecognitionStatus(result: FaceRecognitionResponse | null) {
  if (!result) {
    return 'Waiting for recognition';
  }

  if (result.status === 'no_face') {
    return 'No face detected';
  }

  return result.authorized ? 'Authorized employee detected' : 'Unauthorized or unknown face';
}

export function MonitoringPage() {
  const [headCount] = useState(12);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });
  const [exitConfirm, setExitConfirm] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognitionResult, setRecognitionResult] = useState<FaceRecognitionResponse | null>(null);
  const [lastRecognitionAt, setLastRecognitionAt] = useState<string | null>(null);
  const [capturedFramePreview, setCapturedFramePreview] = useState<string | null>(null);
  const [cameraMessage, setCameraMessage] = useState('Start the camera to begin live face recognition.');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionInFlightRef = useRef(false);

  const alerts = [
    { date: '2026-01-07', time: '14:30', image: 'Worker #1', violation: 'Missing Helmet' },
    { date: '2026-01-07', time: '14:28', image: 'Worker #3', violation: 'Missing Safety Vest' },
    { date: '2026-01-07', time: '14:25', image: 'Worker #7', violation: 'Missing Gloves' },
    { date: '2026-01-07', time: '14:20', image: 'Worker #2', violation: 'Missing Helmet' },
  ];

  const stopCameraStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    recognitionInFlightRef.current = false;
    setIsStreaming(false);
    setIsRecognizing(false);
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      stopCameraStream();
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before using live monitoring.',
      });
      return;
    }

    const intervalId = window.setInterval(async () => {
      if (recognitionInFlightRef.current) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      const frame = await captureVideoFrame(video, canvas);
      if (!frame) {
        return;
      }

      recognitionInFlightRef.current = true;
      setIsRecognizing(true);
      setCapturedFramePreview(canvas.toDataURL('image/jpeg', 0.85));

      try {
        const result = await recognizeEmployeeFace(frame, token);
        setRecognitionResult(result);
        setLastRecognitionAt(
          new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        );
        setCameraMessage(
          result.status === 'no_face'
            ? 'Camera is live. No face is currently visible to the model.'
            : 'Camera is live and recognition is running against uploaded employee faces.',
        );
      } catch (error) {
        stopCameraStream();
        setModalState({
          isOpen: true,
          title: 'Recognition Failed',
          message:
            error instanceof Error
              ? error.message
              : 'The backend could not process the live frame.',
        });
      } finally {
        recognitionInFlightRef.current = false;
        setIsRecognizing(false);
      }
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isStreaming]);

  const handleStartCamera = async () => {
    const token = getAccessToken();
    if (!token) {
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before starting the live camera feed.',
      });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setModalState({
        isOpen: true,
        title: 'Camera Unsupported',
        message: 'Your browser does not support webcam access for live monitoring.',
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      setRecognitionResult(null);
      setLastRecognitionAt(null);
      setCapturedFramePreview(null);
      setCameraMessage('Camera is live and recognition is running against uploaded employee faces.');
      setIsStreaming(true);
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Camera Access Failed',
        message:
          error instanceof Error
            ? error.message
            : 'The browser could not open your camera.',
      });
    }
  };

  const handleStopCamera = () => {
    stopCameraStream();
    setCameraMessage('Camera stopped. Start the stream again when you want to resume recognition.');
  };

  const handleSave = () => {
    setModalState({
      isOpen: true,
      title: 'Success',
      message: 'Monitoring report saved successfully!',
    });
  };

  const handleExitClick = () => {
    setExitConfirm(true);
  };

  const handleExitConfirm = () => {
    setExitConfirm(false);
    stopCameraStream();
    window.history.back();
  };

  const handleExitCancel = () => {
    setExitConfirm(false);
  };

  const statusIsAuthorized = recognitionResult?.status !== 'no_face' && recognitionResult?.authorized;

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={false} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Supervisor – Monitoring & Alert Notification</h1>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <h2 className="font-serif text-2xl text-[#4a3c2a]">Live Camera Feed</h2>

                  <div className="flex gap-3">
                    {!isStreaming ? (
                      <button
                        onClick={handleStartCamera}
                        className="flex items-center gap-2 bg-[#ff8c42] text-white px-5 py-2.5 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors"
                      >
                        <Play className="w-4 h-4" />
                        Start Camera
                      </button>
                    ) : (
                      <button
                        onClick={handleStopCamera}
                        className="flex items-center gap-2 bg-gray-700 text-white px-5 py-2.5 rounded-full shadow-md hover:bg-gray-800 transition-colors"
                      >
                        <Square className="w-4 h-4" />
                        Stop Camera
                      </button>
                    )}
                  </div>
                </div>

                <div className="aspect-video bg-gray-900 rounded-2xl relative overflow-hidden">
                  {isStreaming ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={liveFeedImage}
                      alt="Live camera placeholder"
                      className="w-full h-full object-cover opacity-75"
                    />
                  )}

                  <div className="absolute top-4 left-4 bg-red-600 px-3 py-1 rounded flex items-center gap-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    <span className="text-white text-sm font-semibold">{isStreaming ? 'LIVE' : 'OFFLINE'}</span>
                  </div>

                  {!isStreaming && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center p-6">
                      <div className="text-center text-white max-w-sm">
                        <Camera className="w-12 h-12 mx-auto mb-3" />
                        <p className="text-lg font-medium mb-2">Live face recognition is ready</p>
                        <p className="text-sm text-white/85">{cameraMessage}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#ff8c42]/10 rounded-full flex items-center justify-center">
                      <ScanFace className="w-6 h-6 text-[#ff8c42]" />
                    </div>
                    <div>
                      <p className="text-[#6b5d4f]">Face Recognition</p>
                      <p className="font-serif text-2xl text-[#4a3c2a]">{formatRecognitionStatus(recognitionResult)}</p>
                    </div>
                  </div>

                  <div
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
                      statusIsAuthorized
                        ? 'bg-[#e4f5eb] text-[#1f7a4d]'
                        : 'bg-[#fde9e3] text-[#b14a2c]'
                    }`}
                  >
                    {statusIsAuthorized ? (
                      <ShieldCheck className="w-4 h-4" />
                    ) : (
                      <ShieldAlert className="w-4 h-4" />
                    )}
                    {statusIsAuthorized ? 'Authorized' : 'Needs Attention'}
                  </div>
                </div>

                <div className="grid sm:grid-cols-[1.2fr_0.8fr] gap-5">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="rounded-2xl bg-[#f9f6f0] border border-[#e5dcc9] p-4">
                      <p className="text-[#6b5d4f]">Employee</p>
                      <p className="text-lg font-semibold text-[#4a3c2a]">
                        {recognitionResult?.matched_employee_name ?? 'Unknown'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#f9f6f0] border border-[#e5dcc9] p-4">
                      <p className="text-[#6b5d4f]">Match Score</p>
                      <p className="text-lg font-semibold text-[#4a3c2a]">{formatScore(recognitionResult?.score)}</p>
                    </div>
                    <div className="rounded-2xl bg-[#f9f6f0] border border-[#e5dcc9] p-4">
                      <p className="text-[#6b5d4f]">Threshold</p>
                      <p className="text-lg font-semibold text-[#4a3c2a]">
                        {recognitionResult ? recognitionResult.threshold.toFixed(3) : '--'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#f9f6f0] border border-[#e5dcc9] p-4">
                      <p className="text-[#6b5d4f]">Last Checked</p>
                      <p className="text-lg font-semibold text-[#4a3c2a]">{lastRecognitionAt ?? '--'}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#e5dcc9] bg-[#f9f6f0] p-4">
                    <p className="text-[#6b5d4f] mb-3">Latest Captured Frame</p>
                    <div className="aspect-square rounded-2xl overflow-hidden bg-[#e8e0d1] flex items-center justify-center">
                      {capturedFramePreview ? (
                        <img
                          src={capturedFramePreview}
                          alt="Latest recognized frame"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center px-6">
                          <ScanFace className="w-10 h-10 text-[#bfae97] mx-auto mb-3" />
                          <p className="text-sm text-[#6b5d4f]">A snapshot from the live camera will appear here during recognition.</p>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-[#6b5d4f] mt-3">{cameraMessage}</p>
                    {isRecognizing && <p className="text-sm text-[#ff8c42] mt-2">Analyzing current frame...</p>}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[#ff8c42]/10 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-[#ff8c42]" />
                    </div>
                    <div>
                      <p className="text-[#6b5d4f]">Head Count</p>
                      <p className="font-serif text-3xl text-[#4a3c2a]">{headCount}</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-2 bg-[#ff8c42] text-white px-6 py-3 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors"
                    >
                      <Save className="w-5 h-5" />
                      Save
                    </button>
                    <button
                      onClick={handleExitClick}
                      className="flex items-center gap-2 bg-gray-600 text-white px-6 py-3 rounded-full shadow-md hover:bg-gray-700 transition-colors"
                    >
                      <X className="w-5 h-5" />
                      Exit
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
              <h2 className="font-serif text-2xl text-[#4a3c2a] mb-6">Real-Time Alerts</h2>
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full">
                  <thead className="border-b-2 border-[#d4cbb7] sticky top-0 bg-white">
                    <tr>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Date</th>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Time</th>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Detected Image</th>
                      <th className="text-left py-3 px-2 text-[#6b5d4f]">Violation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert, index) => (
                      <tr key={index} className="border-b border-[#d4cbb7]/50">
                        <td className="py-3 px-2 text-[#4a3c2a] text-sm">{alert.date}</td>
                        <td className="py-3 px-2 text-[#6b5d4f] text-sm">{alert.time}</td>
                        <td className="py-3 px-2">
                          {index === 0 ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-red-500">
                              <img
                                src={workerDetectedImage}
                                alt="Detected Worker"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-12 h-12 bg-[#ff8c42]/20 rounded-lg flex items-center justify-center text-xs text-[#ff8c42]">
                              {alert.image}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                            {alert.violation}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <WarningModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ ...modalState, isOpen: false })}
        title={modalState.title}
        message={modalState.message}
      />

      <WarningConfirmModal
        isOpen={exitConfirm}
        onCancel={handleExitCancel}
        onConfirm={handleExitConfirm}
        title="Warning!"
        message="Are you sure you want to exit monitoring?"
      />

      <Footer />
    </div>
  );
}
