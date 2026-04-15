import { AlertTriangle } from 'lucide-react';

interface WarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
}

export function WarningModal({ isOpen, onClose, title, message }: WarningModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#f5f3ed] rounded-3xl shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-[#ff8c42]/20 rounded-full flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6 text-[#ff8c42]" />
          </div>
          <h2 className="font-serif text-xl text-[#4a3c2a] mb-2">{title}</h2>
          <p className="text-[#6b5d4f] mb-4 text-sm">{message}</p>
          <button
            onClick={onClose}
            className="bg-[#ff8c42] text-white px-6 py-2 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors text-sm"
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}