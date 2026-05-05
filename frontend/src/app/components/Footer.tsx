import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="bg-white border-t border-[#e0d5c7] py-3 mt-auto">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row gap-2 sm:gap-0 justify-between items-center text-center sm:text-left">
        <p className="text-xs text-[#8b7355]">© 2025-2026 Falcon Vision</p>
        <Link to="/help" className="text-xs text-[#d87545] hover:text-[#c42c1f] transition-colors">
          Help and Support
        </Link>
      </div>
    </footer>
  );
}
