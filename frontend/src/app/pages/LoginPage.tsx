import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Footer } from '../components/Footer';
import { getMe, login } from '../lib/api';
import { getHomePathForRole, saveAuthSession } from '../lib/auth';
import logoImage from '../../assets/images/logo.png';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    }
  });

  const onSubmit = async (data: LoginFormValues) => {
    try {
      const tokenResponse = await login(data);
      const currentUser = await getMe(tokenResponse.access_token);

      saveAuthSession(tokenResponse.access_token, currentUser);
      toast.success('Logged in successfully');
      navigate(getHomePathForRole(currentUser.role), { replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to log in right now.';

      toast.error(message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fde8d8] transition-colors duration-300">
      <nav className="bg-white shadow-sm border-b border-[#e0d5c7]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center h-14">
            <Link to="/" className="flex items-center space-x-2">
              <img src={logoImage} alt="Falcon Vision Logo" className="w-10 h-10" />
              <span className="font-serif text-lg text-[#d87545]">Falcon Vision</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center py-8 px-6">
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-md border-2 border-[#d87545]">
          <h1 className="font-serif text-2xl text-[#9e2a2b] text-center mb-6">Log In</h1>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-[#8b7355] mb-1.5 text-sm">Email</label>
              <input
                type="email"
                {...register('email')}
                className={`w-full px-3 py-2 rounded-xl border ${errors.email ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                placeholder="Enter your email"
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="block text-[#8b7355] mb-1.5 text-sm">Password</label>
              <input
                type="password"
                {...register('password')}
                className={`w-full px-3 py-2 rounded-xl border ${errors.password ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                placeholder="Enter your password"
              />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <div className="text-right">
              <Link to="/forgot-password" className="text-[#d87545] hover:text-[#c42c1f] text-xs">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#d87545] text-white py-2.5 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors text-sm disabled:opacity-70 flex items-center justify-center font-medium"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Logging in...
                </>
              ) : (
                'Log In'
              )}
            </button>

            <p className="text-center text-[#8b7355] text-xs">
              Don't have an account? <Link to="/signup" className="text-[#d87545] hover:text-[#c42c1f]">Sign up</Link>
            </p>
          </form>
        </div>
      </div>

      <Footer />
    </div>
  );
}
