import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Footer } from '../components/Footer';
import { WarningModal } from '../components/WarningModal';
import logoImage from '../../assets/images/logo.png';

export function HelpPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });

  const MAX_MESSAGE_LENGTH = 200;

  const faqs = [
    {
      question: 'What is Falcon Vision?',
      answer: 'Falcon Vision is an industrial safety monitoring system that uses computer vision to detect safety violations in real-time, including PPE compliance, unauthorized access, equipment overheating, and fall detection.'
    },
    {
      question: 'How do I upload a safety regulation PDF?',
      answer: 'As a Factory Admin, navigate to "Upload Safety Regulation" from the main menu. Drag and drop your PDF file or click "Select File". The system will automatically extract safety rules and categorize them by module.'
    },
    {
      question: 'How does PPE detection work?',
      answer: 'Our vision model analyzes camera feeds in real-time to detect whether workers are wearing required personal protective equipment such as helmets, safety vests, gloves, and protective eyewear.'
    },
    {
      question: 'Can I control who has monitoring access?',
      answer: 'Yes, Factory Admins can grant or remove monitoring access permissions through the "Monitor Access Permission" page in settings. You can manage access by employee name and email.'
    },
    {
      question: 'How do I view alerts history?',
      answer: 'Both Admins and Supervisors can view alerts history from the main navigation menu. The history includes charts showing violations by type and over time, with filtering options by date and violation type.'
    }
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.message.length > MAX_MESSAGE_LENGTH) {
      setModalState({
        isOpen: true,
        title: 'Warning!',
        message: `Description limited to ${MAX_MESSAGE_LENGTH} characters, and you exceed it with ${formData.message.length}.`
      });
      return;
    }

    setModalState({
      isOpen: true,
      title: 'Success',
      message: 'Thank you! Your message has been sent to our support team.'
    });
    setFormData({ name: '', email: '', message: '' });
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

      <div className="flex-1 py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-serif text-4xl text-[#9e2a2b] text-center mb-12">Help and Support</h1>

          {/* FAQ Section */}
          <section className="mb-12">
            <h2 className="font-serif text-2xl text-[#4a3c2a] mb-6">Frequently Asked Questions</h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <div key={index} className="bg-white rounded-2xl shadow-md border border-[#d4cbb7] overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-[#f5f3ed] transition-colors"
                  >
                    <span className="font-serif text-lg text-[#4a3c2a]">{faq.question}</span>
                    {openFaq === index ? (
                      <ChevronUp className="w-5 h-5 text-[#ff8c42]" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#6b5d4f]" />
                    )}
                  </button>
                  {openFaq === index && (
                    <div className="px-6 pb-4 text-[#6b5d4f]">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Contact Form */}
          <section>
            <h2 className="font-serif text-2xl text-[#4a3c2a] mb-6">Contact Us</h2>
            <div className="bg-gradient-to-br from-[#d87545] to-[#c42c1f] rounded-3xl shadow-xl overflow-hidden">
              <button
                onClick={() => setContactFormOpen(!contactFormOpen)}
                className="w-full px-8 py-6 flex justify-between items-center text-left hover:opacity-90 transition-opacity"
              >
                <div>
                  <h3 className="font-serif text-xl text-white mb-1">Get in Touch</h3>
                  <p className="text-white/90 text-sm">Have a question? Send us a message and we'll get back to you soon.</p>
                </div>
                {contactFormOpen ? (
                  <ChevronUp className="w-6 h-6 text-white flex-shrink-0 ml-4" />
                ) : (
                  <ChevronDown className="w-6 h-6 text-white flex-shrink-0 ml-4" />
                )}
              </button>

              {contactFormOpen && (
                <div className="bg-white px-8 pb-8 pt-6">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block text-[#6b5d4f] mb-1.5 text-sm font-medium">Name</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e0d5c7] focus:outline-none focus:border-[#d87545] text-sm"
                        placeholder="Your full name"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[#6b5d4f] mb-1.5 text-sm font-medium">Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e0d5c7] focus:outline-none focus:border-[#d87545] text-sm"
                        placeholder="your.email@example.com"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[#6b5d4f] mb-1.5 text-sm font-medium">Message</label>
                      <textarea
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e0d5c7] focus:outline-none focus:border-[#d87545] min-h-[120px] text-sm"
                        placeholder="How can we help you?"
                        required
                      />
                      <p className="text-xs text-[#8b7355] mt-1">Maximum {MAX_MESSAGE_LENGTH} characters</p>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-[#d87545] text-white py-3 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors font-medium"
                    >
                      Send Message
                    </button>
                  </form>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <Footer />
      <WarningModal
        isOpen={modalState.isOpen}
        title={modalState.title}
        message={modalState.message}
        onClose={() => setModalState({ isOpen: false, title: '', message: '' })}
      />
    </div>
  );
}