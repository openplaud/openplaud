import { redirect } from "next/navigation";
import { Footer } from "@/components/footer";
import { Comparison } from "@/components/landing/comparison";
import { Deploy } from "@/components/landing/deploy";
import { Features } from "@/components/landing/features";
import { FinalCTA } from "@/components/landing/final-cta";
import { ForProfessionals } from "@/components/landing/for-professionals";
import { Hero } from "@/components/landing/hero";
import { LandingNav } from "@/components/landing/landing-nav";
import { RedditQuotes } from "@/components/landing/reddit-quotes";
import { TheMath } from "@/components/landing/the-math";
import { getSession } from "@/lib/auth-server";

export default async function HomePage() {
    const session = await getSession();

    if (session?.user) {
        redirect("/dashboard");
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
                <Comparison />
                <Deploy />
                <FinalCTA />
            </main>
            <Footer />
        </div>
    );
}
