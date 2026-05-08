"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Triggers the CSV export endpoint after collecting a reason. We can't use a
 * plain anchor with download attribute because the endpoint requires a
 * `reason` query param and (more importantly) is treated as a mutation: a
 * stale elevated cookie should bounce to /admin/reauth, not silently 404
 * the download.
 */
export function ExportCsvButton() {
    const [busy, setBusy] = useState(false);

    async function onClick() {
        const reason = window.prompt(
            "Reason for downloading the pricing-snapshot CSV (logged):",
        );
        if (!reason || reason.trim().length < 4) {
            toast.error("Reason required (min 4 chars)");
            return;
        }
        setBusy(true);
        try {
            const url = `/api/admin/pricing-snapshot/export.csv?reason=${encodeURIComponent(
                reason,
            )}`;
            const res = await fetch(url);
            if (res.status === 404) {
                toast.error("Admin session expired. Reauth and try again.");
                window.location.href =
                    "/admin/reauth?next=/admin/pricing-snapshot";
                return;
            }
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                toast.error(j.error ?? `Export failed (${res.status})`);
                return;
            }
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objUrl;
            // Server sets Content-Disposition with a timestamped filename;
            // browsers respect that, but we set a fallback for safety.
            a.download = "openplaud-pricing-snapshot.csv";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objUrl);
            toast.success("Export downloaded");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Button onClick={onClick} disabled={busy} variant="outline">
            {busy ? "Exporting..." : "Export CSV"}
        </Button>
    );
}
