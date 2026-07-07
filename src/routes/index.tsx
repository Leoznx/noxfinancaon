import { createFileRoute } from "@tanstack/react-router";
import { InstitutionalHeader } from "@/components/landing/InstitutionalHeader";
import { InstitutionalHero, SocialProofLogos, SolutionPresentation } from "@/components/landing/SectionsBasic";
import { ComparativeSection, BenefitsGrid } from "@/components/landing/ComparativeAndBenefits";
import { PlansSection, InstitutionalNumbers } from "@/components/landing/PlansAndNumbers";
import { CareerProgramSection } from "@/components/landing/CareerProgramSection";
import { RegistrationForm, InstitutionalTestimonials } from "@/components/landing/RegistrationAndTestimonials";
import { InstitutionalFaq, InstitutionalFooter } from "@/components/landing/FaqAndFooterInstitutional";
import { ArrowUp } from "lucide-react";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NOX - Seguro Fiança" },
      { name: "description", content: "Plataforma de seguro fiança 100% digital. Aprovação em até 1 minuto, cobertura de até 40x o aluguel, sem fiador e sem caução." },
      { property: "og:title", content: "NOX FIANÇA — Seguro Fiança Digital" },
      { property: "og:description", content: "Aprovação em até 1 minuto, sem fiador e sem caução." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.noxfianca.com" },
    ],
    links: [{ rel: "canonical", href: "https://www.noxfianca.com" }],
  }),
  component: Index,
});

function Index() {
  const [showScrollTop, setShowScrollTop] = useState(false);
  

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 800);
    };
    

    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };


  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans selection:bg-[#FACC15] selection:text-neutral-900">
      <InstitutionalHeader />
      
      <main>
        <InstitutionalHero />
        <SocialProofLogos />
        <SolutionPresentation />
        <ComparativeSection />
        <BenefitsGrid />
        <PlansSection />
        <CareerProgramSection />
        <InstitutionalNumbers />
        <RegistrationForm />
        <InstitutionalTestimonials />
        <InstitutionalFaq />
      </main>

      <InstitutionalFooter />


      {/* Scroll to Top */}
      {showScrollTop && (
          <button 
            onClick={scrollToTop}
            className="fixed bottom-28 right-9 z-50 bg-white border border-neutral-200 p-2.5 rounded-lg text-neutral-900 hover:bg-neutral-50 shadow-lg transition-all"
          >
            <ArrowUp size={20} strokeWidth={1.5} />
          </button>
        )}

    </div>
  );
}
