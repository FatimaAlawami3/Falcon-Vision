import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Mail } from 'lucide-react';
import { Footer } from '../components/Footer';
import logoImage from '../../assets/images/logo.png';

export function HelpPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [contactFormOpen, setContactFormOpen] = useState(false);

  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || 'support@falcon-vision.site';
  const contactHref = `mailto:${supportEmail}?subject=${encodeURIComponent('Falcon Vision support')}`;

  const faqs = [
    {
      question: 'What is Falcon Vision?',
      answer: 'Falcon Vision is an AI-powered industrial safety monitoring system. It helps factories monitor safety conditions using computer vision modules such as PPE detection, fall detection, fire detection, and face recognition.'
    },
    {
      question: 'What can Factory Admins manage?',
      answer: 'Factory Admins can upload safety regulations, manage employees, upload employee face images, control supervisor monitoring access, view alert history, and update system settings.'
    },
    {
      question: 'How do safety regulations work?',
      answer: 'Admins can upload a safety regulation PDF. Falcon Vision extracts safety rules from the document and uses them to support monitoring decisions, reports, and safety compliance review.'
    },
    {
      question: 'How does real-time monitoring work?',
      answer: 'Authorized users can open the monitoring page and run safety modules for the selected zone. The system analyzes camera input and shows results for PPE compliance, falls, fire risks, face recognition, and active alerts.'
    },
    {
      question: 'How do alerts and reports work?',
      answer: 'Detected safety issues are saved as alerts. Admins and supervisors can review alert history, delete old records when needed, and save monitoring session reports for later review.'
    },
    {
      question: 'How can I reset my password?',
      answer: 'Use the Forgot password link on the login page. Enter your email, choose a new password, and confirm it. If the email exists in the system, the password is updated immediately.'
    },
    {
      question: 'How can I contact the project team?',
      answer: 'Open the Contact Us section on this page and select Email Us. It will open your email app with the project contact email already filled in.'
    }
  ];

  const teamMembers = [
    'Raneem Alqahtani',
    'Haya Aldossary',
    'Norah Aldossary',
    'Anfal Bamardouf',
    'Fai Alotaibi',
    'Fatima Alawami',
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#fde8d8] overflow-x-hidden">
      <nav className="bg-white shadow-sm border-b border-[#e0d5c7]">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex min-w-0 items-center gap-2">
              <img src={logoImage} alt="Falcon Vision Logo" className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0" />
              <span className="font-serif text-lg sm:text-xl text-[#d87545] truncate">Falcon Vision</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex-1 py-8 sm:py-12 px-4 sm:px-6">
        <div className="w-full max-w-4xl mx-auto">
          <h1 className="font-serif text-3xl sm:text-4xl text-[#9e2a2b] text-center mb-8 sm:mb-12">Help and Support</h1>

          {/* FAQ Section */}
          <section className="mb-8 sm:mb-12">
            <h2 className="font-serif text-xl sm:text-2xl text-[#4a3c2a] mb-4 sm:mb-6">Frequently Asked Questions</h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <div key={index} className="bg-white rounded-xl sm:rounded-2xl shadow-md border border-[#d4cbb7] overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full px-4 sm:px-6 py-4 flex justify-between items-center gap-4 text-left hover:bg-[#f5f3ed] transition-colors"
                  >
                    <span className="min-w-0 font-serif text-base sm:text-lg text-[#4a3c2a] leading-snug">{faq.question}</span>
                    {openFaq === index ? (
                      <ChevronUp className="w-5 h-5 text-[#ff8c42] flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#6b5d4f] flex-shrink-0" />
                    )}
                  </button>
                  {openFaq === index && (
                    <div className="px-4 sm:px-6 pb-4 text-sm sm:text-base text-[#6b5d4f] leading-relaxed">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="mb-8 sm:mb-12">
            <h2 className="font-serif text-xl sm:text-2xl text-[#4a3c2a] mb-4 sm:mb-6">Who We Are</h2>
            <div className="space-y-5 text-[#6b5d4f]">
              <p className="text-sm sm:text-base leading-relaxed">
                Falcon Vision was developed by Artificial Intelligence students at Imam Abdulrahman Bin Faisal University.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {teamMembers.map((member) => (
                  <div key={member} className="bg-white border border-[#d4cbb7] rounded-xl px-4 py-3 text-[#4a3c2a] shadow-sm">
                    {member}
                  </div>
                ))}
              </div>
              <p className="text-sm sm:text-base leading-relaxed">
                Supervised by: <span className="font-medium text-[#4a3c2a]">Dr. Noor Maher Felemban</span>
              </p>
            </div>
          </section>

          {/* Contact */}
          <section>
            <h2 className="font-serif text-xl sm:text-2xl text-[#4a3c2a] mb-4 sm:mb-6">Contact Us</h2>
            <div className="bg-gradient-to-br from-[#d87545] to-[#c42c1f] rounded-xl sm:rounded-2xl shadow-xl overflow-hidden">
              <button
                onClick={() => setContactFormOpen(!contactFormOpen)}
                className="w-full px-4 sm:px-8 py-5 sm:py-6 flex justify-between items-center gap-4 text-left hover:opacity-90 transition-opacity"
              >
                <div className="min-w-0">
                  <h3 className="font-serif text-lg sm:text-xl text-white mb-1">Get in Touch</h3>
                  <p className="text-white/90 text-sm">Have a question? Send us a message and we'll get back to you soon.</p>
                </div>
                {contactFormOpen ? (
                  <ChevronUp className="w-5 h-5 sm:w-6 sm:h-6 text-white flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 sm:w-6 sm:h-6 text-white flex-shrink-0" />
                )}
              </button>

              {contactFormOpen && (
                <div className="bg-white px-4 sm:px-8 pb-6 sm:pb-8 pt-5 sm:pt-6">
                  <p className="text-sm sm:text-base text-[#6b5d4f] mb-4 break-words">
                    Email us directly at{' '}
                    <a href={contactHref} className="text-[#d87545] hover:text-[#c42c1f] font-medium">
                      {supportEmail}
                    </a>
                  </p>
                  <a
                    href={contactHref}
                    className="w-full bg-[#d87545] text-white py-3 rounded-full shadow-md hover:bg-[#c42c1f] transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    <Mail className="w-4 h-4" />
                    Email Us
                  </a>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <Footer />
    </div>
  );
}
