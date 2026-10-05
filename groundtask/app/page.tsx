import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/sections/Hero";
import { Problem } from "@/components/sections/Problem";
import { SampleTask } from "@/components/sections/SampleTask";
import { Produces } from "@/components/sections/Produces";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Trust } from "@/components/sections/Trust";
import { UseCasesAbout } from "@/components/sections/UseCasesAbout";
import { Contact } from "@/components/sections/Contact";

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <Problem />
        <SampleTask />
        <Produces />
        <HowItWorks />
        <Trust />
        <UseCasesAbout />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
