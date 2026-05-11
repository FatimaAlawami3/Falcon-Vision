import { Shield, Eye, Flame, AlertTriangle } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';

export function SupervisorHomePage() {
  const services = [
    {
      icon: Shield,
      title: 'PPE Detection',
      description: 'Automatically detect and verify proper use of personal protective equipment'
    },
    {
      icon: AlertTriangle,
      title: 'Fall Detection',
      description: 'Real-time detection of falls and accidents at height'
    },
    {
      icon: Flame,
      title: 'Fire Detection',
      description: 'Detects fire and smoke at an early stage to support rapid response and prevention'
    },
    {
      icon: Eye,
      title: 'Face Recognition',
      description: 'Identify authorized personnel in restricted areas and track attendance'
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#fde8d8]">
      <Navigation isAdmin={false} />

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
          <h1 className="font-serif text-3xl mb-4">Welcome, Supervisor</h1>
          <p className="text-base mb-2 max-w-2xl mx-auto">
            Safety Supervisor Dashboard
          </p>
          <p className="text-sm max-w-3xl mx-auto opacity-90">
            Monitor live camera feeds, receive real-time violation alerts, save monitoring reports,
            and review comprehensive safety analytics.
          </p>
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
