import { Footer } from "@/components/footer";
import { TranscriptionNotifications } from "@/components/transcription-notifications";
import { Toaster } from "@/components/ui/sonner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <TranscriptionNotifications />
            <div className="flex flex-col min-h-[100vh]">
                <main className="flex-1 flex flex-col">{children}</main>
                <Footer />
            </div>
            <Toaster />
        </>
    );
}
