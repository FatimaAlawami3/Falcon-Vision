import { useNavigate } from 'react-router-dom';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { ShieldAlert } from 'lucide-react';

export function NoPermissionPage() {
  const navigate = useNavigate();
  
  const handleOk = () => {
    navigate('/supervisor');
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={false} />
      
      <div className="flex-1 flex items-center justify-center py-12 px-6">
        <div className="bg-white rounded-3xl shadow-xl p-12 max-w-lg w-full text-center border border-[#d4cbb7]">
          <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6 mx-auto">
            <ShieldAlert className="w-12 h-12 text-red-600" />
          </div>
          
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-6">Warning!</h1>
          
          <p className="text-[#6b5d4f] text-lg mb-8">
            You do not have monitoring permission. Please contact your administrator to request access.
          </p>
          
          <button
            onClick={handleOk}
            className="bg-[#ff8c42] text-white px-12 py-3 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors"
          >
            Ok
          </button>
        </div>
      </div>
      
      <Footer />
    </div>
  );
}
