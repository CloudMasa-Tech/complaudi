import { Footer } from '../landing/components/Footer';
import { Hero } from '../landing/components/Hero';
import { Navbar } from '../landing/components/Navbar';
import {
  CTASection, HowItWorks, ProblemSection, SecuritySection, SolutionWorkflow, UseCases, WhyComplaudi,
} from '../landing/components/sections';
import { ComplianceOverview, DocumentManagement } from '../landing/components/ProductSurfaces';
import { VerificationDemo } from '../landing/components/VerificationDemo';

/**
 * The public marketing page. Signed out it is the entry point at `/`; signed in
 * the router never reaches it (see App.tsx), so it does not need to care about
 * the session.
 *
 * Section order is deliberate: the visitor meets the product, the problem, the
 * answer, the strongest capability, then the supporting surfaces, then the
 * reasons, the trust argument and the ask.
 */
export function Landing() {
  // The document title and robots meta are route-driven from App.tsx rather than
  // set here: this component can only restore the previous value on unmount,
  // which misses a hard page load straight into /login or /register. See
  // useDocumentMeta() in App.tsx.
  return (
    <div className="lp-landing-root">
      <div className="lp">
        <a className="lp-skip" href="#main">Skip to content</a>
        <Navbar />
      </div>

      <main id="main">
        <Hero />
        <div className="lp">
          <ProblemSection />
          <SolutionWorkflow />
          <VerificationDemo />
          <ComplianceOverview />
          <DocumentManagement />
          <HowItWorks />
          <WhyComplaudi />
          <UseCases />
          <SecuritySection />
          <CTASection />
        </div>
      </main>

      <div className="lp">
        <Footer />
      </div>
    </div>
  );
}
