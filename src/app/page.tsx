import { redirect } from "next/navigation";
import { Footer } from "@/components/footer";
import { Deploy } from "@/components/landing/deploy";
import { FAQ } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { FinalCTA } from "@/components/landing/final-cta";
import { ForProfessionals } from "@/components/landing/for-professionals";
import { Hero } from "@/components/landing/hero";
import { LandingNav } from "@/components/landing/landing-nav";
import { Pricing } from "@/components/landing/pricing";
import { RedditQuotes } from "@/components/landing/reddit-quotes";
import { TheMath } from "@/components/landing/the-math";
import { getSession } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function HomePage() {
    const session = await getSession();

    if (session?.user) {
        redirect("/dashboard");
    }

    // Self-host instances don't serve the marketing landing -- send logged-out
    // visitors straight to login. The marketing surface is only meaningful on
    // the OpenPlaud-operated hosted product, which sets IS_HOSTED=true.
    if (!env.IS_HOSTED) {
        redirect("/login");
    }

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/30 overflow-x-hidden">
            <LandingNav />
            <main className="flex-1">
                <Hero />
                <TheMath />
                <Features />
                <RedditQuotes />
                <ForProfessionals />
                <Pricing />
                <Deploy />
                <FAQ />
                <FinalCTA />
            </main>
            <Footer />
        </div>
    );
}
