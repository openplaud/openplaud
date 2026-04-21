import { Check } from "lucide-react";

export function Comparison() {
    return (
        <section className="py-24 container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
                <h2 className="text-3xl font-bold text-center mb-12">
                    The Smart Alternative
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-8 rounded-2xl border border-border bg-card">
                        <h3 className="text-xl font-bold mb-6 text-muted-foreground">
                            Official Cloud
                        </h3>
                        <ul className="space-y-4">
                            <li className="flex items-center gap-3 text-muted-foreground">
                                <div className="size-5 rounded-full border border-border flex items-center justify-center shrink-0">
                                    ×
                                </div>
                                Monthly subscription fees
                            </li>
                            <li className="flex items-center gap-3 text-muted-foreground">
                                <div className="size-5 rounded-full border border-border flex items-center justify-center shrink-0">
                                    ×
                                </div>
                                Limited recording minutes
                            </li>
                            <li className="flex items-center gap-3 text-muted-foreground">
                                <div className="size-5 rounded-full border border-border flex items-center justify-center shrink-0">
                                    ×
                                </div>
                                Data stored on their servers
                            </li>
                            <li className="flex items-center gap-3 text-muted-foreground">
                                <div className="size-5 rounded-full border border-border flex items-center justify-center shrink-0">
                                    ×
                                </div>
                                Fixed AI model choices
                            </li>
                        </ul>
                    </div>

                    <div className="p-8 rounded-2xl border-2 border-primary bg-card relative shadow-lg">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary text-primary-foreground text-xs font-bold uppercase rounded-full tracking-wider">
                            OpenPlaud
                        </div>
                        <h3 className="text-xl font-bold mb-6 text-primary">
                            Self-Hosted
                        </h3>
                        <ul className="space-y-4">
                            <li className="flex items-center gap-3">
                                <div className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                                    <Check className="size-3" />
                                </div>
                                <span className="font-medium">
                                    Free forever (Self-hosted)
                                </span>
                            </li>
                            <li className="flex items-center gap-3">
                                <div className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                                    <Check className="size-3" />
                                </div>
                                <span className="font-medium">
                                    Unlimited recordings
                                </span>
                            </li>
                            <li className="flex items-center gap-3">
                                <div className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                                    <Check className="size-3" />
                                </div>
                                <span className="font-medium">
                                    Data stays on your machine
                                </span>
                            </li>
                            <li className="flex items-center gap-3">
                                <div className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                                    <Check className="size-3" />
                                </div>
                                <span className="font-medium">
                                    Any AI Model (GPT-4, Claude, Llama)
                                </span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </section>
    );
}
