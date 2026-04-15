import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';

export function UploadRegulationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [extractedRules, setExtractedRules] = useState(false);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'application/pdf') {
        setModalState({
          isOpen: true,
          title: 'Warning!',
          message: 'Unsupported file type! Please upload a PDF file.'
        });
        return;
      }
      setFile(selectedFile);
      // Simulate extraction
      setTimeout(() => setExtractedRules(true), 1000);
    }
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === 'application/pdf') {
      setFile(droppedFile);
      setTimeout(() => setExtractedRules(true), 1000);
    } else {
      setModalState({
        isOpen: true,
        title: 'Warning!',
        message: 'Unsupported file type! Please upload a PDF file.'
      });
    }
  };
  
  const rules = {
    'PPE Detection': [
      'Hard hat must be worn at all times in construction zones',
      'Safety vest required in all operational areas',
      'Protective gloves mandatory when handling chemicals',
      'Safety goggles required in welding areas'
    ],
    'Face Recognition': [
      'Access control at main entrance and exits',
      'Restricted area monitoring for authorized personnel only',
      'Time and attendance tracking'
    ],
    'Thermal Imaging': [
      'Monitor equipment temperature above 85°C',
      'Check pipe temperatures in boiler rooms',
      'Alert when machinery exceeds safe operating temperature'
    ],
    'Fall Detection': [
      'Monitor work at heights above 2 meters',
      'Immediate alert on fall detection',
      'Safety harness compliance verification'
    ]
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-[#fde8d8]">
      <Navigation isAdmin={true} />
      
      <div className="flex-1 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-serif text-4xl text-[#9e2a2b] mb-8">Upload File</h1>
          
          <div className="grid md:grid-cols-2 gap-8">
            {/* Left Side - Upload */}
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="bg-white rounded-3xl border-2 border-dashed border-[#d87545] p-12 text-center hover:border-[#c42c1f] transition-colors"
              >
                <Upload className="w-16 h-16 text-[#d87545] mx-auto mb-4" />
                <h3 className="font-serif text-xl text-[#9e2a2b] mb-2">Drag and drop files here</h3>
                <p className="text-[#8b7355] mb-2">File Supported .pdf</p>
                <label className="inline-block mt-4">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <span className="bg-[#d87545] text-white px-8 py-3 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors cursor-pointer inline-block">
                    Select File
                  </span>
                </label>
                {file && (
                  <p className="text-[#9e2a2b] mt-4">Selected: {file.name}</p>
                )}
              </div>
            </div>
            
            {/* Right Side - Extracted Rules */}
            <div className="space-y-4">
              <h2 className="font-serif text-2xl text-[#9e2a2b]">Falcon Vision will detect based on the extracted safety regulations as follows:</h2>
              
              {extractedRules ? (
                <div className="space-y-4">
                  {Object.entries(rules).map(([category, items]) => (
                    <div key={category} className="bg-[#d4bfa7] rounded-2xl p-6 shadow-md">
                      <h3 className="font-serif text-lg text-[#9e2a2b] mb-3">{category}</h3>
                      <ul className="space-y-2">
                        {items.map((rule, index) => (
                          <li key={index} className="text-[#8b4a32] flex items-start">
                            <span className="text-[#9e2a2b] mr-2">•</span>
                            <span>{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-12 shadow-md border border-[#e0d5c7] text-center">
                  <p className="text-[#8b7355]">Upload a PDF to see extracted safety rules</p>
                </div>
              )}
            </div>
          </div>
          
          {extractedRules && (
            <div className="mt-8 text-center">
              <button className="bg-[#d87545] text-white px-12 py-4 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors">
                Start Monitoring
              </button>
            </div>
          )}
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