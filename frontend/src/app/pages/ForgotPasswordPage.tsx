import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Footer } from '../components/Footer';
import { WarningModal } from '../components/WarningModal';
import { forgotPassword } from '../lib/api';
import logoImage from '../../assets/images/logo.png';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setModalState({
        isOpen: true,
        title: 'Warning!',
        message: 'Please enter a valid email address.',
      });
      return;
    }

    if (password.length < 8) {
      setModalState({
        isOpen: true,
        title: 'Weak Password',
        message: 'Your new password must be at least 8 characters long.',
      });
      return;
    }

    if (password !== confirmPassword) {
      setModalState({
        isOpen: true,
        title: 'Passwords Do Not Match',
        message: 'Please make sure both password fields match.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await forgotPassword({ email: email.trim(), password });
      setModalState({
        isOpen: true,
        title: 'Password Updated',
        message: response.message,
      });
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Reset Failed',
        message:
          error instanceof Error
            ? error.message
            : 'We could not reset your password right now.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fde8d8]">
      <nav className="bg-white shadow-sm border-b border-[#e0d5c7]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center space-x-2">
              <img src={logoImage} alt="Falcon Vision Logo" className="w-12 h-12" />
              <span className="font-serif text-xl text-[#d87545]">Falcon Vision</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center py-12 px-6">
        <div className="bg-white rounded-3xl shadow-xl p-10 w-full max-w-md border-2 border-[#d87545]">
          <h1 className="font-serif text-3xl text-[#9e2a2b] text-center mb-8">Reset Password</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-[#8b7355] mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545]"
                placeholder="Enter your email"
                required
              />
            </div>

            <div>
              <label className="block text-[#8b7355] mb-2">New Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545]"
                placeholder="Enter your new password"
                required
              />
            </div>

            <div>
              <label className="block text-[#8b7355] mb-2">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545]"
                placeholder="Confirm your new password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#d87545] text-white py-3 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors disabled:opacity-70 flex items-center justify-center"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating Password...
                </>
              ) : (
                'Reset Password'
              )}
            </button>

            <p className="text-center text-[#8b7355]">
              Remember your password? <Link to="/login" className="text-[#d87545] hover:text-[#c42c1f]">Log in</Link>
            </p>
          </form>
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
