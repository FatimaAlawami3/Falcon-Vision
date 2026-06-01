import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Footer } from '../components/Footer';
import { PasswordInput } from '../components/PasswordInput';
import { PasswordRequirementsList } from '../components/PasswordRequirementsList';
import { registerOrganization } from '../lib/api';
import { isStrongPassword, PASSWORD_REQUIREMENTS_ERROR } from '../lib/passwordValidation';
import logoImage from '../../assets/images/logo.png';

// Letters (any language) and spaces only.
const NAME_REGEX = /^[\p{L} ]+$/u;
// Saudi mobile format: 05 followed by 8 digits (10 digits total).
const PHONE_REGEX = /^05\d{8}$/;

const signUpSchema = z.object({
  organizationName: z.string().min(2, 'Organization name is required'),
  industry: z.string().min(1, 'Industry is required'),
  country: z.string().min(1, 'Country is required'),
  city: z.string().min(1, 'City is required'),
  address: z.string().min(1, 'Address is required'),
  adminFirstName: z.string()
    .min(1, 'First name is required')
    .regex(NAME_REGEX, 'First name can only contain letters and spaces'),
  adminLastName: z.string()
    .min(1, 'Last name is required')
    .regex(NAME_REGEX, 'Last name can only contain letters and spaces'),
  adminPhone: z.string()
    .min(1, 'Phone number is required')
    .regex(PHONE_REGEX, 'Phone must start with 05 and be 10 digits (e.g. 0512345678)'),
  adminEmail: z.string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z.string()
    .refine(isStrongPassword, PASSWORD_REQUIREMENTS_ERROR),
  confirmPassword: z.string().min(1, 'Please confirm your password')
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type SignUpFormValues = z.infer<typeof signUpSchema>;

export function SignUpPage() {
  const navigate = useNavigate();

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    mode: 'onChange',
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

      toast.success('Admin account created successfully. Please log in.');
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
                  className={`w-full px-3 py-2 rounded-xl border ${errors.industry ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.industry && <p className="text-red-500 text-xs mt-1">{errors.industry.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Country</label>
                <input
                  type="text"
                  {...register('country')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.country ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.country && <p className="text-red-500 text-xs mt-1">{errors.country.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">City</label>
                <input
                  type="text"
                  {...register('city')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.city ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Address</label>
                <input
                  type="text"
                  {...register('address')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.address ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
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
                  placeholder="0512345678"
                  {...register('adminPhone')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.adminPhone ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.adminPhone && <p className="text-red-500 text-xs mt-1">{errors.adminPhone.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Password</label>
                <PasswordInput
                  {...register('password')}
                  className={`w-full px-3 py-2 rounded-xl border ${errors.password ? 'border-red-500' : 'border-[#e0d5c7]'} focus:outline-none focus:border-[#d87545] bg-white text-[#4a3c2a] text-sm`}
                />
                {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
              </div>

              <div>
                <label className="block text-[#8b7355] mb-1.5 text-sm">Confirm Password</label>
                <PasswordInput
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

            <PasswordRequirementsList password={password || ''} />
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
