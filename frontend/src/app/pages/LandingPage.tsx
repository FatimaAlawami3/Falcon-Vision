import { Link } from 'react-router-dom';
import { Shield, Eye, Thermometer, AlertTriangle } from 'lucide-react';
import { Footer } from '../components/Footer';
import logoImage from '../../assets/images/logo.png';

export function LandingPage() {
  const services = [
    {
      icon: Shield,
      title: 'PPE Detection',
      description: 'Automatically detect and verify proper use of personal protective equipment'
    },
    {
      icon: Eye,
      title: 'Face Recognition',
      description: 'Identify authorized personnel in restricted areas and track attendance'
    },
    {
      icon: Thermometer,
      title: 'Thermal Imaging',
      description: 'Monitor equipment temperature to prevent overheating and failures'
    },
    {
      icon: AlertTriangle,
      title: 'Fall Detection',
      description: 'Real-time detection of falls and accidents at height'
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#fde8d8]">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-[#e0d5c7]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center space-x-2">
              <img src={logoImage} alt="Falcon Vision Logo" className="w-10 h-10" />
              <h1 className="font-serif text-lg text-[#d87545]">Falcon Vision</h1>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-[#6b5d4f] to-[#4a3c2a] text-white py-12">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1593812725955-6d89f01ded2d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxpbmR1c3RyaWFsJTIwd29ya2VyJTIwc2FmZXR5JTIwaGVsbWV0fGVufDF8fHx8MTc2Nzc3MTM5Mnww&ixlib=rb-4.1.0&q=80&w=1080')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        />
        <div className="relative max-w-7xl mx-auto px-6 text-center">
          <h1 className="font-serif text-3xl mb-4">Falcon Vision</h1>
          <p className="text-base mb-4 max-w-2xl mx-auto">
            Industrial Safety Monitoring System
          </p>
          <p className="text-sm mb-6 max-w-3xl mx-auto opacity-90">
            Enhance workplace safety with real-time vision models that detect PPE compliance,
            recognize personnel, monitor thermal conditions, and prevent fall accidents.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              to="/login"
              className="bg-[#d87545] text-white px-6 py-2 rounded-full shadow-lg hover:bg-[#c42c1f] transition-colors text-sm"
            >
              Log In
            </Link>
            <Link
              to="/signup"
              className="bg-white text-[#9e2a2b] px-6 py-2 rounded-full shadow-lg hover:bg-gray-100 transition-colors text-sm"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </section>

      {/* Our Services Section */}
      <section className="py-10">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="font-serif text-2xl text-center text-[#9e2a2b] mb-8">Our Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {services.map((service, index) => (
              <div
                key={index}
                className="bg-white rounded-[2.5rem] p-6 shadow-md hover:shadow-xl transition-shadow border-2 border-[#d87545]"
              >
                <div className="w-12 h-12 bg-[#d87545]/10 rounded-full flex items-center justify-center mb-3 mx-auto">
                  <service.icon className="w-6 h-6 text-[#d87545]" />
                </div>
                <h3 className="font-serif text-base text-[#9e2a2b] text-center mb-2">{service.title}</h3>
                <p className="text-[#8b7355] text-center text-xs">{service.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}