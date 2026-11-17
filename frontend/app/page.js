import SiteNav from "./components/SiteNav";
import Hero from "./components/landing/Hero";
import Stats from "./components/landing/Stats";
import Features from "./components/landing/Features";
import HowItWorks from "./components/landing/HowItWorks";
import Engines from "./components/landing/Engines";
import WhyChoose from "./components/landing/WhyChoose";
import Footer from "./components/landing/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <SiteNav />
      <main>
        <Hero />
        <Stats />
        <Features />
        <HowItWorks />
        <Engines />
        <WhyChoose />
      </main>
      <Footer />
    </div>
  );
}
