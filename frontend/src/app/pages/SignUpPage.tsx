import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { Footer } from '../components/Footer';
import { registerOrganization } from '../lib/api';
import logoImage from '../../assets/images/logo.png';

const signUpSchema = z.object({
  organizationName: z.string().min(2, 'Organization name is required'),
  industry: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  adminFirstName: z.string().min(1, 'First name is required'),
  adminLastName: z.string().min(1, 'Last name is required'),
  adminPhone: z.string().optional(),
  adminEmail: z.string().email('Please enter a valid email address'),
  password: z.string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Contains uppercase letter')
    .regex(/[a-z]/, 'Contains lowercase letter')
    .regex(/[0-9]/, 'Contains number')
    .regex(/[^A-Za-z0-9]/, 'Contains symbol'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type SignUpFormValues = z.infer<typeof signUpSchema>;

export function SignUpPage() {
  const navigate = useNavigate();

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      organizationName: '',
      industry: '',
      country: '',
      city: '',
      address: '',
      adminFirstName: '',
      adminLastName: '',
      adminPhone: '',
      adminEmail: '',
      password: '',
      confirmPassword: ''
    }
  });

  const password = watch('password');

  const passwordRequirements = [
    { text: 'At least 8 characters', met: password?.length >= 8 },
    { text: 'Contains uppercase letter', met: /[A-Z]/.test(password || '') },
    { text: 'Contains lowercase letter', met: /[a-z]/.test(password || '') },
    { text: 'Contains number', met: /[0-9]/.test(password || '') },
    { text: 'Contains symbol', met: /[^A-Za-z0-9]/.test(password || '') }
  ];

  const onSubmit = async (data: SignUpFormValues) => {
    try {
      await registerOrganization({
        organization_name: data.organizationName.trim(),
        industry: data.industry?.trim() || undefined,
        country: data.country?.trim() || undefined,
        city: data.city?.trim() || undefined,
        address: data.address?.trim() || undefined,
        admin_full_name: `${data.adminFirstName.trim()} ${data.adminLastName.trim()}`.trim(),
        admin_email: data.adminEmail.trim(),
        admin_password: data.password,
        admin_phone: data.adminPhone?.trim() || undefined,
      });

      toast.success('Organization created successfully. Please log in.');
      navigate('/login', { replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create the account right now.';

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
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-4xl border-2 border-[#d87545]">
          <h1 className="font-serif text-2xl text-[#9e2a2b] text-center mb-6">Sign Up</h1>

          <div className="grid md:grid-cols-2 gap-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Organization Name</label>
                <input
                  type="text"
                  {...register('organizationName')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.organizationName ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.organizationName && <p className="text-red-500 text-xs mt-1">{errors.organizationName.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Industry</label>
                <input
                  type="text"
                  {...register('industry')}
                  className="w-full px-3 py-2 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm"
                />
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Country</label>
                <input
                  type="text"
                  {...register('country')}
                  className="w-full px-3 py-2 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm"
                />
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">City</label>
                <input
                  type="text"
                  {...register('city')}
                  className="w-full px-3 py-2 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm"
                />
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Address</label>
                <input
                  type="text"
                  {...register('address')}
                  className="w-full px-3 py-2 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm"
                />
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Admin First Name</label>
                <input
                  type="text"
                  {...register('adminFirstName')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.adminFirstName ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.adminFirstName && <p className="text-red-500 text-xs mt-1">{errors.adminFirstName.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Admin Last Name</label>
                <input
                  type="text"
                  {...register('adminLastName')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.adminLastName ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.adminLastName && <p className="text-red-500 text-xs mt-1">{errors.adminLastName.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Admin Email</label>
                <input
                  type="email"
                  {...register('adminEmail')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.adminEmail ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.adminEmail && <p className="text-red-500 text-xs mt-1">{errors.adminEmail.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Admin Phone</label>
                <input
                  type="tel"
                  {...register('adminPhone')}
                  className="w-full px-3 py-2 rounded-xl border border-[#e0d5c7] focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm"
                />
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Password</label>
                <input
                  type="password"
                  {...register('password')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.password ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Confirm Password</label>
                <input
                  type="password"
                  {...register('confirmPassword')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.confirmPassword ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#d87545] text-white py-2.5 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors text-sm disabled:opacity-70 flex items-center justify-center font-medium"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Sign Up'
                )}
              </button>

              <p className="text-center text-[#8b7355] text-xs">
                Already have an account? <Link to="/login" className="text-[#d87545] hover:text-[#c42c1f]">Log in</Link>
              </p>
            </form>

            <div className="bg-[#fde8d8] rounded-2xl p-5 border border-[#e0d5c7]">
              <h3 className="font-serif text-base text-[#9e2a2b] mb-3">Password Requirements</h3>
              <div className="space-y-2">
                {passwordRequirements.map((req, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center ${req.met ? 'bg-green-500' : 'bg-gray-300'
                      }`}>
                      {req.met && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className={`text-xs ${req.met ? 'text-green-700' : 'text-[#8b7355]'}`}>{req.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
