import { Link, useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';
import logoImage from '../../assets/images/logo.png';

interface NavigationProps {
  isAdmin?: boolean;
}

export function Navigation({ isAdmin = false }: NavigationProps) {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="bg-white shadow-sm border-b border-[#e0d5c7]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex justify-between items-center h-14">
          <div className="flex items-center space-x-6">
            <Link to={isAdmin ? "/admin" : "/supervisor"} className="flex items-center space-x-2">
              <img src={logoImage} alt="Falcon Vision Logo" className="w-10 h-10" />
              <span className="font-serif text-lg text-[#d87545]">Falcon Vision</span>
            </Link>

            <div className="flex space-x-4 ml-6">
              <Link
                to={isAdmin ? "/admin" : "/supervisor"}
                className={`transition-colors text-sm ${isActive(isAdmin ? "/admin" : "/supervisor") ? 'text-[#d87545]' : 'text-[#d87545] hover:text-[#c42c1f]'}`}
              >
                Home
              </Link>

              {isAdmin ? (
                <>
                  <Link
                    to="/admin/upload-regulation"
                    className={`transition-colors text-sm ${isActive("/admin/upload-regulation") ? 'text-[#d87545]' : 'text-[#d87545] hover:text-[#c42c1f]'}`}
                  >
                    Upload Safety Regulation
                  </Link>
                  <Link
                    to="/admin/alerts-history"
                    className={`transition-colors text-sm ${isActive("/admin/alerts-history") ? 'text-[#d87545]' : 'text-[#d87545] hover:text-[#c42c1f]'}`}
                  >
                    Alerts History
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/supervisor/monitoring"
                    className={`transition-colors text-sm ${isActive("/supervisor/monitoring") ? 'text-[#d87545]' : 'text-[#d87545] hover:text-[#c42c1f]'}`}
                  >
                    Monitoring & Alert Notification
                  </Link>
                  <Link
                    to="/supervisor/alerts-history"
                    className={`transition-colors text-sm ${isActive("/supervisor/alerts-history") ? 'text-[#d87545]' : 'text-[#d87545] hover:text-[#c42c1f]'}`}
                  >
                    Alerts History
                  </Link>
                </>
              )}
            </div>
          </div>

          <Link to={isAdmin ? "/admin/settings" : "/supervisor/settings"}>
            <Settings className="w-5 h-5 text-[#d87545] hover:text-[#c42c1f] transition-colors cursor-pointer" />
          </Link>
        </div>
      </div>
    </nav>
  );
}