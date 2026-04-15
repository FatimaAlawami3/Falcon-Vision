import { useNavigate } from 'react-router-dom';
import { User, Upload, Shield, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { clearAuthSession } from '../../lib/auth';

export function AdminSettingsPage() {
  const navigate = useNavigate();
  
  const menuItems = [
    { icon: User, label: 'Profile', path: '/admin/profile' },
    { icon: Upload, label: 'Upload Employee Faces', path: '/admin/upload-faces' },
    { icon: Shield, label: 'Monitor Access Permission', path: '/admin/monitor-access' },
    { icon: LogOut, label: 'Log out', path: '/', isLogout: true }
  ];
  
  const handleClick = (item: typeof menuItems[0]) => {
    if (item.isLogout) {
      if (window.confirm('Are you sure you want to log out?')) {
        clearAuthSession();
        toast.success('Logged out successfully');
        navigate('/login', { replace: true });
      }
    } else {
      navigate(item.path);
    }
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={true} />
      
      <div className="flex-1 py-8 px-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-serif text-2xl text-[#4a3c2a] mb-6">Admin – Settings</h1>
          
          <div className="bg-white rounded-3xl shadow-xl border border-[#d4cbb7] overflow-hidden">
            <div className="divide-y divide-[#d4cbb7]">
              {menuItems.map((item, index) => (
                <button
                  key={index}
                  onClick={() => handleClick(item)}
                  className="w-full px-6 py-4 flex items-center gap-3 hover:bg-[#f5f3ed] transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-[#ff8c42]/10 rounded-full flex items-center justify-center">
                    <item.icon className="w-5 h-5 text-[#ff8c42]" />
                  </div>
                  <span className="font-serif text-base text-[#4a3c2a]">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <Footer />
    </div>
  );
}
